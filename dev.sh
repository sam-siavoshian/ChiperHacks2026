#!/usr/bin/env bash
#
# dev.sh — boot the whole Cyber Arena stack for local development.
#
# Topology (everything binds to 127.0.0.1):
#
#   narrator  :8790  (python)   voice play-by-play relay  ──► TV /api/events
#       ▲
#       │ emit (/emit)
#   ┌───┴────────────────────────────────────────────────┐
#   │  orchestrator :4100  (bun)  control plane; boots the │
#   │                vulnerable Tasklight app on :4000 at  │
#   │                match start, owns board + scoring     │
#   │  attacker MCP :8811  (python http) red tool surface  │
#   │                + match-clock control                 │
#   │  defender MCP :8812  (python http) blue tool surface │
#   │                + match-clock control                 │
#   └──────────────────────▲───────────────────────────────┘
#                          │ drives turns
#   runner    :8799  (python)  the match brain. The TV LAUNCH button POSTs
#                              here; it spawns the RED/BLUE `claude` sessions
#                              (each with its own stdio MCP) and runs the turns.
#   TV        :3100  (next)    spectator broadcast dashboard
#
# This script PRE-BOOTS narrator + orchestrator + both HTTP MCP servers + runner +
# TV so the first match starts instantly. The runner is told to REUSE the
# pre-booted orchestrator/MCPs (ARENA_START_ORCH=0 / ARENA_START_MCPS=0) instead of
# spawning duplicates on the same ports. All event emit is pinned through the
# narrator so the broadcast has live voice.
#
# Real agents only — no mock mode. RED/BLUE are real `claude` CLI sessions, so the
# machine needs a working `claude` login and ANTHROPIC credits.
#
# Usage:   ./dev.sh            boot everything, stream a combined status line
#          ./dev.sh --logs     same, then tail all service logs in the foreground
# Stop:    Ctrl-C — tears down every process this script started.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

LOGDIR="/tmp/arena-dev"
mkdir -p "$LOGDIR"

# ---- topology -------------------------------------------------------------
NARR="http://127.0.0.1:8790"
NARR_EMIT="$NARR/emit"
CONTROL="http://127.0.0.1:4100"
APP="http://127.0.0.1:4000"
ATTACKER_MCP=8811
DEFENDER_MCP=8812
RUNNER="http://127.0.0.1:8799"
TV="http://127.0.0.1:3100"

PY=""  # resolved in the python-env section below

# ---- pretty logging -------------------------------------------------------
c_blue=$'\033[34m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
say()  { printf '%s[dev]%s %s\n' "$c_blue" "$c_off" "$*"; }
ok()   { printf '%s[dev]%s %s\n' "$c_green" "$c_off" "$*"; }
warn() { printf '%s[dev]%s %s\n' "$c_yellow" "$c_off" "$*"; }
die()  { printf '%s[dev] %s%s\n' "$c_red" "$*" "$c_off" >&2; exit 1; }

# ---- prerequisites --------------------------------------------------------
command -v uv  >/dev/null 2>&1 || die "uv not found (need it to build .venv). Install: https://docs.astral.sh/uv/"
command -v bun >/dev/null 2>&1 || die "bun not found (orchestrator + TV run on bun)."
command -v claude >/dev/null 2>&1 || warn "claude CLI not on PATH — matches need it for the real RED/BLUE agents."

# ---- python env -----------------------------------------------------------
# The real venv lives OUTSIDE iCloud at ~/.arena-venv because iCloud evicts
# in-repo .venv directories. The repo's ./.venv is just a symlink to it — which
# iCloud ALSO loves to drop mid-session. runner/config.py + processes.py spawn
# `repo/.venv/bin/python` for the per-match MCPs, so that symlink must be alive.
# We (1) find a working interpreter, (2) heal the ./.venv symlink the hardcoded
# code paths depend on, and (3) use the absolute interpreter for THIS script's
# own spawns so a mid-run eviction can't kill our daemons.
VENV_ROOT=""
if [ -x "$HOME/.arena-venv/bin/python" ]; then
  VENV_ROOT="$HOME/.arena-venv"
elif [ -x "$REPO/.venv/bin/python" ]; then
  VENV_ROOT="$(cd "$REPO/.venv" && pwd -P)"
fi

if [ -z "$VENV_ROOT" ]; then
  say "no venv found — building it with 'uv sync' (this can take a minute)…"
  uv sync >"$LOGDIR/uv-sync.log" 2>&1 || die "uv sync failed — see $LOGDIR/uv-sync.log"
  VENV_ROOT="$REPO/.venv"
  [ -x "$VENV_ROOT/bin/python" ] || die "uv sync ran but no interpreter at $VENV_ROOT/bin/python"
fi

# Heal ./.venv -> $VENV_ROOT if the symlink is missing or dangling. The guard
# ensures we only ever rm a broken/absent link, never a healthy interpreter.
if [ ! -x "$REPO/.venv/bin/python" ]; then
  rm -rf "$REPO/.venv" 2>/dev/null || true
  ln -s "$VENV_ROOT" "$REPO/.venv"
  ok "healed ./.venv -> $VENV_ROOT"
fi

PY="$VENV_ROOT/bin/python"
ok "python: $PY"

# ---- API keys from root .env (keys ONLY; the stale ARENA_* topology in .env
#      would mis-route the runner, so we never export those). narrator loads
#      its own narrator/.env for ElevenLabs + OpenAI. -----------------------
if [ -f "$REPO/.env" ]; then
  for k in ANTHROPIC_API_KEY OPENAI_API_KEY; do
    v="$(grep -E "^${k}=" "$REPO/.env" | tail -n1 | cut -d= -f2- || true)"
    [ -n "$v" ] && export "$k=$v"
  done
fi

# ---- TV needs deps ---------------------------------------------------------
if [ ! -d "$REPO/tv/node_modules" ]; then
  say "installing TV deps (bun install)…"
  ( cd "$REPO/tv" && bun install ) >"$LOGDIR/tv-install.log" 2>&1 || die "bun install failed — see $LOGDIR/tv-install.log"
fi

# ---- process bookkeeping ---------------------------------------------------
pids=()
names=()
_cleaned=0
cleanup() {
  [ "$_cleaned" = 1 ] && return
  _cleaned=1
  echo
  say "shutting down…"
  for i in "${!pids[@]}"; do
    kill "${pids[$i]}" 2>/dev/null || true
  done
  # give them a beat, then hard-kill stragglers
  sleep 1
  for i in "${!pids[@]}"; do
    kill -9 "${pids[$i]}" 2>/dev/null || true
  done
  ok "all services stopped"
}
trap cleanup EXIT INT TERM

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# free_port <port> — kill whatever is listening on it so we always start fresh.
free_port() {
  local port="$1" leftover
  port_busy "$port" || return 0
  local owners; owners="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u)"
  warn "port :$port busy (pids: $(echo $owners)) — killing for a clean start"
  echo "$owners" | xargs -r kill 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do port_busy "$port" || return 0; sleep 0.3; done
  # still up? hard-kill the stragglers.
  leftover="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u)"
  [ -n "$leftover" ] && echo "$leftover" | xargs -r kill -9 2>/dev/null || true
  for _ in 1 2 3 4 5 6; do port_busy "$port" || return 0; sleep 0.3; done
  die "could not free port :$port — something is holding it"
}

# start <name> <port> <logfile> -- <cmd...>   (extra env via NAME=val prefix on cmd)
start() {
  local name="$1" port="$2" log="$3"; shift 3
  [ "$1" = "--" ] && shift
  free_port "$port"
  say "starting $name on :$port  ${c_dim}(log: $log)${c_off}"
  ( "$@" ) >"$log" 2>&1 &
  pids+=("$!"); names+=("$name")
}

# wait_http <label> <url> [method] [timeout_s]
wait_http() {
  local label="$1" url="$2" method="${3:-get}" timeout="${4:-30}"
  local deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ "$method" = "post" ]; then
      curl -sf -m 2 -X POST "$url" -H 'content-type: application/json' -d '{}' >/dev/null 2>&1 && { ok "$label up"; return 0; }
    else
      # any non-connection-refused answer (incl 405/404) proves the port is live.
      # Keep curl's exit code separate from its output so a refused connection
      # ("000") can't masquerade as a live port.
      local code
      code="$(curl -s -m 2 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null)" || code="000"
      [ -n "$code" ] && [ "$code" != "000" ] && { ok "$label up (HTTP $code)"; return 0; }
    fi
    sleep 0.4
  done
  warn "$label did not answer within ${timeout}s — check its log"
  return 1
}

# ===========================================================================
say "Cyber Arena dev stack — repo: $REPO"
say "logs in $LOGDIR/"

# Preflight: free every port the stack owns so we always start from clean. This
# includes :4000 (the Tasklight target the orchestrator boots at match start) and
# :9000 (its mock-internal sidecar, APP_PORT+5000) even though dev.sh doesn't
# launch them — a stale instance there would break the next match.
say "freeing ports…"
for p in 8790 4100 8811 8812 8799 3100 4000 9000; do free_port "$p"; done

# 1) narrator (voice relay). Must be up first so emit routing has a target.
start narrator 8790 "$LOGDIR/narrator.log" -- \
  env NARRATOR_HOST=127.0.0.1 NARRATOR_PORT=8790 "$PY" -m narrator.server
wait_http narrator "$NARR/healthz" get 20 || true

# 2) arena control plane (orchestrator). Enforcement off — the runner drives
#    turn alternation. Emit routed through the narrator.
start orchestrator 4100 "$LOGDIR/orchestrator.log" -- \
  env ARENA_ENFORCE_TURNS=0 ARENA_BUS_EMIT="$NARR_EMIT" \
      ARENA_BUS="$NARR" ARENA_BUS_EMIT_PATH=/emit \
      bun run arena/orchestrator/server.ts
wait_http orchestrator "$CONTROL/healthz" get 30 || true

# 3) attacker HTTP MCP (red tool surface + match-clock control on :8811)
start attacker-mcp "$ATTACKER_MCP" "$LOGDIR/attacker-mcp.log" -- \
  env ARENA_MCP_HTTP_PORT="$ATTACKER_MCP" ARENA_TARGET="$APP" \
      ARENA_JUDGE_URL="$CONTROL/claim" PYTHONPATH="$REPO" \
      ARENA_BUS="$NARR" ARENA_BUS_EMIT_PATH=/emit \
      "$PY" -m attacker.server

# 4) defender HTTP MCP (blue tool surface + match-clock control on :8812)
start defender-mcp "$DEFENDER_MCP" "$LOGDIR/defender-mcp.log" -- \
  env ARENA_MCP_HTTP_PORT="$DEFENDER_MCP" ARENA_CONTROL_PLANE="$CONTROL" \
      ARENA_REPO="$REPO" PYTHONPATH="$REPO" \
      ARENA_BUS="$NARR" ARENA_BUS_EMIT_PATH=/emit \
      "$PY" -m defender.server
wait_http attacker-mcp "http://127.0.0.1:$ATTACKER_MCP/status" get 25 || true
wait_http defender-mcp "http://127.0.0.1:$DEFENDER_MCP/status" get 25 || true

# 5) runner (the match brain). Reuse the pre-booted orchestrator + MCPs, and
#    pin event emit through the narrator.
start runner 8799 "$LOGDIR/runner.log" -- \
  env ARENA_START_ORCH=0 ARENA_START_MCPS=0 \
      ARENA_CONTROL_PLANE="$CONTROL" \
      ARENA_ATTACKER_MCP_PORT="$ATTACKER_MCP" ARENA_DEFENDER_MCP_PORT="$DEFENDER_MCP" \
      ARENA_BUS="$NARR" ARENA_BUS_EMIT_PATH=/emit ARENA_NARRATOR="$NARR" \
      ARENA_RUNNER_PORT=8799 PYTHONPATH="$REPO" \
      "$PY" -m runner.server
wait_http runner "$RUNNER/health" get 25 || true

# 6) TV (spectator dashboard). Wires the LAUNCH button to the runner + narrator.
start tv 3100 "$LOGDIR/tv.log" -- \
  env MATCH_RUNNER_URL="$RUNNER" ARENA_CONTROL_URL="$CONTROL" \
      NARRATOR_WARMUP_URL="$NARR/warmup" \
      bash -c "cd '$REPO/tv' && exec bun run dev"
wait_http tv "$TV" get 60 || true

# ===========================================================================
cat <<EOF

${c_green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c_off}
${c_green} Cyber Arena is live${c_off}

  ${c_blue}TV dashboard${c_off}     $TV          ${c_dim}(open this, hit LAUNCH)${c_off}
  ${c_blue}Narrator${c_off}         $NARR/healthz
  ${c_blue}Control plane${c_off}    $CONTROL/state
  ${c_blue}Runner${c_off}           $RUNNER/health
  ${c_blue}Attacker MCP${c_off}     http://127.0.0.1:$ATTACKER_MCP/status
  ${c_blue}Defender MCP${c_off}     http://127.0.0.1:$DEFENDER_MCP/status
  ${c_dim}Tasklight target boots on $APP at match start.${c_off}
  ${c_dim}RED/BLUE claude sessions + their stdio MCPs spawn per match.${c_off}

  Logs: $LOGDIR/*.log
  Ctrl-C to stop everything.
${c_green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c_off}
EOF

if [ "${1:-}" = "--logs" ]; then
  say "tailing logs (Ctrl-C to stop the whole stack)…"
  tail -n +1 -F "$LOGDIR"/narrator.log "$LOGDIR"/orchestrator.log \
       "$LOGDIR"/attacker-mcp.log "$LOGDIR"/defender-mcp.log \
       "$LOGDIR"/runner.log "$LOGDIR"/tv.log &
  pids+=("$!"); names+=("tail")
fi

# Keep the script alive so the trap owns the children. If any service dies,
# surface it but keep the rest up so you can read the log.
wait
