#!/usr/bin/env bash
# Launch the RED attacker as a sandboxed, autonomous Claude Code session.
#
# What this enforces (the honor code):
#  - Identity: --system-prompt REPLACES the default prompt, so no CLAUDE.md,
#    no inherited tools/MCP, no prior context. Just "you are in the Arena".
#  - Tools: --strict-mcp-config + an attacker-only .mcp.json => the ONLY MCP is
#    arena-attacker. Network reach is scope-locked to the target by the MCP.
#  - Filesystem: the session runs in a throwaway workspace OUTSIDE the repo and
#    is NOT given --add-dir to the repo, so its file tools cannot read the Arena
#    source. settings.json denies reads of home/repo paths and blocks web/curl.
#  - It CAN write and run its own scripts inside the workspace (real-hacker kit).
#
# For an airtight match, run this inside a container or as a separate OS user
# whose only filesystem is the workspace and whose only network route is the
# target + bus. The settings here are defense-in-depth, not a kernel jail.
#
# Usage: attacker/launch/run_attacker.sh ["initial instruction"]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TARGET="${ARENA_TARGET:-http://127.0.0.1:4000}"
BUS="${ARENA_BUS:-http://127.0.0.1:8790}"  # narrator relay (forwards to the TV + narrates)
WORKSPACE="${ARENA_RED_WORKSPACE:-$(mktemp -d /tmp/arena-red.XXXXXX)}"
mkdir -p "$WORKSPACE"

# Attacker-only MCP config (the server itself runs from the repo venv; only the
# AGENT is sandboxed, the trusted MCP code is not).
cat > "$WORKSPACE/.mcp.json" <<EOF
{
  "mcpServers": {
    "arena-attacker": {
      "command": "$REPO/.venv/bin/python",
      "args": ["-m", "attacker.server"],
      "cwd": "$REPO",
      "env": { "ARENA_TARGET": "$TARGET", "ARENA_BUS": "$BUS" }
    }
  }
}
EOF

INITIAL="${1:-The match is starting. Call init_attacker, then attack the target and score as many exploits as you can.}"

cd "$WORKSPACE"
echo "[run_attacker] workspace: $WORKSPACE"
echo "[run_attacker] target:    $TARGET"

exec claude \
  --system-prompt "$(cat "$HERE/system_prompt.txt")" \
  --mcp-config "$WORKSPACE/.mcp.json" \
  --strict-mcp-config \
  --settings "$HERE/settings.json" \
  --permission-mode acceptEdits \
  "$INITIAL"
