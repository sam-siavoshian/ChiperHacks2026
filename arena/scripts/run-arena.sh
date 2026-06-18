#!/usr/bin/env bash
# Launch the Arena control plane (which boots the vulnerable Tasklight app on
# demand). The attacker and defender MCP sessions then drive the match via the
# control plane on :4100. Everything binds to 127.0.0.1.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Arena control plane starting on :4100 (app will boot on :4000 at match start)"
echo "Drive it with: bun run scripts/move.ts start | state | attack <id> | patch <id> | stop"
exec bun run orchestrator/server.ts
