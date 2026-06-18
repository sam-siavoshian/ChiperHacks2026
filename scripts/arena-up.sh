#!/usr/bin/env bash
# Boot the WHOLE Arena stack so the match actually runs:
#
#   narrator :8790  (LLM play-by-play + ElevenLabs voice, relays to the TV)
#   TV       :3100  (the broadcast you watch; warms the narrator on launch)
#   runner   :8799  (the conductor: boots orchestrator :4100 + app :4000 + the
#                    attacker/defender MCPs, and SPAWNS the two Claude sessions)
#
# The TV alone cannot run a match — without the runner there are no agents, so the
# broadcast just sits on "awaiting first request from Red". This brings up all three,
# waits for each to answer, then tells you to open the TV and hit Launch.
#
# Stop everything: scripts/arena-up.sh stop   (or Ctrl-C if run in the foreground)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

PY="$REPO/.venv/bin/python"; [ -x "$PY" ] || PY="python3"
LOG=/tmp
TV_PORT="${TV_PORT:-3100}"

stop() {
  echo "[arena-up] stopping…"
  pkill -f "runner.server" 2>/dev/null || true
  pkill -f "narrator.server" 2>/dev/null || true
  pkill -f "orchestrator/server.ts" 2>/dev/null || true
  pkill -f "server/index.ts" 2>/dev/null || true
  pkill -f "attacker.server" 2>/dev/null || true
  pkill -f "defender.server" 2>/dev/null || true
  pkill -f "next dev" 2>/dev/null || true
  echo "[arena-up] stopped."
}
[ "${1:-}" = "stop" ] && { stop; exit 0; }

wait_up() { # name url tries
  for _ in $(seq 1 "${3:-60}"); do curl -sf -m1 "$2" >/dev/null 2>&1 && { echo "[arena-up] $1 up"; return 0; }; sleep 0.5; done
  echo "[arena-up] WARNING: $1 did not answer at $2"; return 1
}

echo "[arena-up] .venv python: $PY"
"$PY" -c "import attacker.server, defender.server, httpx, jwt, mcp" 2>/dev/null \
  || { echo "[arena-up] FATAL: arena python deps missing in $PY — run: $PY -m pip install -r requirements.txt (or repair the .venv)"; exit 1; }

# 1) narrator (voice + relay)
if lsof -nP -iTCP:8790 -sTCP:LISTEN >/dev/null 2>&1; then echo "[arena-up] narrator already on :8790"; else
  echo "[arena-up] starting narrator :8790"; nohup "$PY" -m narrator.server > "$LOG/arena-narrator.log" 2>&1 & fi
wait_up narrator http://127.0.0.1:8790/healthz 40 || true

# 2) TV broadcast (warms the narrator on launch)
if lsof -nP -iTCP:"$TV_PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "[arena-up] TV already on :$TV_PORT"; else
  echo "[arena-up] starting TV :$TV_PORT"
  ( cd "$REPO/tv" && NARRATOR_WARMUP_URL=http://127.0.0.1:8790/warmup nohup bun run dev -p "$TV_PORT" > "$LOG/arena-tv.log" 2>&1 & )
fi
wait_up TV "http://127.0.0.1:$TV_PORT/api/vulns" 80 || true

# 3) runner (boots orchestrator + app + MCPs and spawns the agents on match start)
if lsof -nP -iTCP:8799 -sTCP:LISTEN >/dev/null 2>&1; then echo "[arena-up] runner already on :8799"; else
  echo "[arena-up] starting runner :8799"; nohup "$PY" -m runner.server > "$LOG/arena-runner.log" 2>&1 & fi
wait_up runner http://127.0.0.1:8799/health 40 || true

cat <<EOF

[arena-up] stack is up:
  TV        http://localhost:$TV_PORT      <- open this, pick models, hit LAUNCH
  narrator  http://127.0.0.1:8790/healthz
  runner    http://127.0.0.1:8799/health   (boots orch :4100 + app :4000 on launch)

Logs: $LOG/arena-{narrator,tv,runner}.log  and  $LOG/arena-session-{attacker,defender}.log
Stop: scripts/arena-up.sh stop
EOF
