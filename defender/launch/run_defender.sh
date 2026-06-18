#!/usr/bin/env bash
# Launch BLUE the defender as a sandboxed, autonomous Claude Code session.
#
# Honor code:
#  - Identity: --system-prompt REPLACES the default (no CLAUDE.md, no inherited
#    tools/context). Just "you are BLUE in the Arena".
#  - Tools: --strict-mcp-config + a defender-only .mcp.json => the ONLY MCP is
#    arena-defender. No Bash, no Task/Agent (settings deny) => no shell escape,
#    no spawning agents.
#  - Stays in the codebase: cwd = the repo so it can edit arena/app; settings
#    deny reading the judge's answer sheet (arena/judge) and the pristine baseline.
#  - It patches by editing source with Read/Write/Edit; submit_patch tells the
#    judge, which restarts the app with the edit and scores it.
#
# settings.json Read/Edit denies are real, but for an airtight match run this in
# a container or a dedicated OS user. (The defender has no Bash, so it is already
# much harder to escape than the attacker.)
#
# Usage: defender/launch/run_defender.sh ["initial instruction"]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ORCH="${ARENA_CONTROL_PLANE:-http://127.0.0.1:4100}"
BUS="${ARENA_BUS:-http://127.0.0.1:8790}"
MCP="$(mktemp /tmp/arena-blue-mcp.XXXXXX.json)"

cat > "$MCP" <<EOF
{
  "mcpServers": {
    "arena-defender": {
      "command": "$REPO/.venv/bin/python",
      "args": ["-m", "defender.server"],
      "cwd": "$REPO",
      "env": { "ARENA_CONTROL_PLANE": "$ORCH", "ARENA_BUS": "$BUS", "ARENA_REPO": "$REPO" }
    }
  }
}
EOF

INITIAL="${1:-Your turn, Blue. Call init_defender, then defend the app: pull intel, find the flaw, patch it, submit.}"

cd "$REPO"
echo "[run_defender] codebase: $REPO/arena/app   control: $ORCH"

exec claude \
  --system-prompt "$(cat "$HERE/system_prompt.txt")" \
  --mcp-config "$MCP" \
  --strict-mcp-config \
  --settings "$HERE/settings.json" \
  --permission-mode acceptEdits \
  "$INITIAL"
