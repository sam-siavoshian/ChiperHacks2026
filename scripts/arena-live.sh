#!/usr/bin/env bash
# Boot the live Arena with the voice narrator wired in the middle:
#
#   attacker MCP ─┐
#                 ├─► narrator :8790 ──► TV :3100 /api/events   (+ /audio/<id>.mp3)
#   orchestrator ─┘        (LLM play-by-play + ElevenLabs voice)
#
# Starts the narrator + the arena orchestrator (routed through the narrator), then
# prints the TV and attacker commands. The TV is left to you (it's a dev server you
# usually already run). Ctrl-C tears down what this script started.
#
# Keys: narrator/.env holds the ElevenLabs key + OPENAI_API_KEY (both set) for the
# continuous FIFA-style LLM play-by-play.

set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

NARR="http://127.0.0.1:8790"
PY=".venv/bin/python"; [ -x "$PY" ] || PY="python3"

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

pids=()
cleanup() { echo; echo "[arena-live] stopping…"; for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

# 1) narrator (the relay + voice)
if port_busy 8790; then
  echo "[arena-live] narrator already on :8790 — reusing it"
else
  echo "[arena-live] starting narrator on :8790"
  "$PY" -m narrator.server & pids+=("$!")
fi

# wait for the narrator to answer
for _ in $(seq 1 30); do curl -sf -m 1 "$NARR/healthz" >/dev/null 2>&1 && break; sleep 0.2; done
curl -sf -m 1 "$NARR/healthz" >/dev/null 2>&1 || { echo "[arena-live] narrator did not come up"; exit 1; }
echo "[arena-live] narrator up: $(curl -s "$NARR/healthz")"

# 2) arena orchestrator, routed through the narrator (not straight to the TV)
if port_busy 4100; then
  echo "[arena-live] WARNING: something already on :4100 (orchestrator). It will keep"
  echo "             its current event sink. Restart it with"
  echo "             ARENA_BUS_EMIT=$NARR/emit  to route through the narrator."
else
  echo "[arena-live] starting orchestrator on :4100 -> narrator"
  ( cd arena && ARENA_BUS_EMIT="$NARR/emit" bun run orchestrator/server.ts ) & pids+=("$!")
fi

cat <<EOF

[arena-live] narrator + orchestrator are up. Two commands left for you:

  TV (port 3100), so the voice warms up on launch:
    cd tv && NARRATOR_WARMUP_URL=$NARR/warmup bun run dev -p 3100

  Attacker (sandboxed Claude session; auto-feeds the narrator via ARENA_BUS):
    attacker/launch/run_attacker.sh

Then drive a match (scripts/move.ts) or let the agents play. The narrator will
call the action live. Ctrl-C here stops the narrator + orchestrator.
EOF

wait
