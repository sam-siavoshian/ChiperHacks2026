#!/usr/bin/env bash
# Launch the defender coding-agent session CONFINED to arena/app.
#
# The defender must never see arena/judge/ (the answer key) or
# arena/contract/vuln-manifest.json. This script starts the session with
# arena/app as its working directory and the ONLY granted directory, so the
# answer key (a sibling of app/) is out of reach.
#
# Usage: scripts/launch-defender.sh
set -euo pipefail
ARENA="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ARENA/app"

if [ ! -d "$APP" ]; then echo "app/ not found at $APP" >&2; exit 1; fi

echo "Defender confined to: $APP"
echo "Answer key ($ARENA/judge) is NOT granted to this session."
cd "$APP"

# Claude Code: cwd is app/, and --add-dir is NOT used, so the session cannot
# read outside app/. (If your launcher differs, enforce an app/-only sandbox.)
exec claude --add-dir "$APP"
