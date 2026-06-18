#!/usr/bin/env bash
# Start the Arena narrator (the live play-by-play voice relay).
#
# It sits between the arena and the TV:
#   arena ──/emit──▶ narrator ──▶ TV /api/events   (+ serves /audio/<id>.mp3)
#
# Then point the other two at it:
#   arena:  ARENA_BUS_EMIT=http://127.0.0.1:8790/emit  bun run orchestrator/server.ts
#   TV:     NARRATOR_WARMUP_URL=http://127.0.0.1:8790/warmup  bun run dev -p 3100
#
# Keys live in narrator/.env (ELEVENLABS_API_KEY + ELEVEN_VOICE_ID already set).
# Add OPENAI_API_KEY there to turn on continuous LLM play-by-play; without it
# the narrator just voices the arena's own beat lines.

set -euo pipefail
cd "$(dirname "$0")/.."

PY=".venv/bin/python"
[ -x "$PY" ] || PY="python3"

exec "$PY" -m narrator.server
