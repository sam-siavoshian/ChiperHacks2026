# Arena Narrator — the live football play-by-play voice

Turns the Arena match into a continuous sportscast. An inline relay that sits
between the arena and the TV broadcast: it watches every event, keeps a veteran
play-by-play commentator talking in real time (OpenAI's fast chat model for the
FIFA-style words, ElevenLabs for the voice), serves the audio, and the TV plays
it in lockstep with a word-by-word caption.

```
  orchestrator ─┐
  attacker MCP  ├─POST /emit─▶  narrator :8790  ──POST──▶  TV :3100 /api/events
  defender MCP ─┘                   │
                                    ├─ relays gameplay events instantly (voice trails ~1s)
                                    ├─ always-talking LLM loop (reacts to every tool call)
                                    ├─ ElevenLabs v3 TTS with emotion (or flash w/ alignment)
                                    └─ serves /audio/<id>.mp3  (the clip the TV <audio> plays)
```

**Inputs = the MCPs.** Both the attacker and defender MCPs self-report every tool
call (intent before, outcome after) via their event bus. Point that bus at the
narrator (`.mcp.json`: `ARENA_BUS=http://127.0.0.1:8790`, `ARENA_BUS_EMIT_PATH=/emit`)
and the LLM narrates the match tool-by-tool — "RED boolean-diff probing search,
the database flinches… BLUE patches it just in time!". The arena orchestrator's
goals/saves/score feed in the same way (`ARENA_BUS_EMIT`).

## Emotion + crowd (the context-aware build)

Every spoken line is classified (`emotion.py`, ported from the partner's
`cyberpitch_narration.py`) into an emotion that shapes the delivery and a crowd
`intensity` (0..1):

| moment | emotion | voice | crowd |
|---|---|---|---|
| RED lands an exploit | `goal` | `[shouting]` v3 tag | ~1.0 |
| BLUE patches / blocks | `save` | `[excited]` | ~0.75 |
| probe closing in | `buildup` | `[excited]` | ~0.72 |
| stalemate | `tense` | `[nervous]` | ~0.5 |
| RED's attempt fails | `setback` | `[sad]` | ~0.26 |
| routine | `neutral` | — | ~0.32 |

Hybrid emotion source (per the partner's note): the narrator LLM is asked to lead
each line with a label like `[goal]` / `[save]`; that's parsed and passed as the
emotion. If it just returns plain text, the emotion is detected from keywords +
punctuation. Either way works.

The commentary event now carries `emotion` and `crowd` alongside `audioUrl`. On
the TV, `CrowdController` plays a continuous stadium loop and ramps its volume to
`crowd`, with a one-shot roar on `goal` (assets in `tv/public/audio/`,
generated with ElevenLabs Sound Effects).

**TTS engine** (`NARRATOR_TTS_ENGINE`):
- `v3` (default) — HTTP stream with eleven_v3 emotion tags. The voice actually
  reacts. Word timings estimated from clip length. Falls back to
  `eleven_multilingual_v2` (tags stripped) if v3 is unavailable.
- `flash` — low-latency WebSocket with exact word alignment, no emotion.

The TV needed only two new optional fields on `commentary` (`emotion`, `crowd`)
plus the `CrowdController`; the caption + voice path was already there.

## Run it (3 processes)

```bash
# 1) narrator (this service)
narrator/run_narrator.sh

# 2) arena — point its event sink at the narrator
ARENA_BUS_EMIT=http://127.0.0.1:8790/emit  bun run arena/orchestrator/server.ts

# 3) TV — tell it where to warm up the voice
NARRATOR_WARMUP_URL=http://127.0.0.1:8790/warmup  bun run dev -p 3100   # in tv/
```

Click **LAUNCH** on the TV init screen (that click also unlocks browser
autoplay, so the voice just works). The narrator starts calling the match the
moment `round_start` fires.

## Keys

`narrator/.env` (gitignored) holds the voice key + voice id, already filled from
the partner's `cyberpitch_voice` prototype:

```
ELEVENLABS_API_KEY=sk_...
ELEVEN_VOICE_ID=KshTMpmdiWWEvpz5gEJQ
```

For the **continuous FIFA-style play-by-play**, an OpenAI key (already set in
`narrator/.env`):

```
OPENAI_API_KEY=sk-proj-...
NARRATOR_MODEL=gpt-5.3-chat-latest   # SOTA fast chat model (~1.7s/line), default
```

The model is briefed as a top-flight football commentator: RED = the attacking
side (exploits are shots on goal), BLUE = the defenders + keeper (patches are
saves), endpoints are zones of the pitch. It calls the action like a Champions
League night.

## Modes (auto-selected by which keys are present)

| keys | behaviour |
|---|---|
| OpenAI + ElevenLabs | full continuous play-by-play **with voice** (the real thing) |
| OpenAI only | continuous captions, no audio |
| ElevenLabs only | voices the arena's own beat lines verbatim (no filler) |
| neither | transparent relay — passes events through untouched |

## How "always talking" works

Two cooperating async tasks:

- **producer** keeps the *next* line generated and ready (LLM → TTS), running
  exactly one line ahead so generation latency hides under the current line's
  playback. It builds each line from the freshest event context, so a goal or
  save gets called within ~one line (~3s) — natural commentator reaction, which
  matches the "voice trails the action" choice.
- **player** emits each ready line to the TV as a `commentary` event and waits
  the clip's real duration before the next, so audio never overlaps.

Lulls get filled with anticipation; the last few lines are fed back to the model
so it never repeats itself. `MAX_LINES_PER_MATCH` caps a runaway match.

## Endpoints

| method | path | purpose |
|---|---|---|
| POST | `/emit` | arena posts events here; relayed to the TV |
| GET | `/audio/{id}.mp3` | the generated voice clip (Range-aware, CORS-open) |
| POST | `/warmup` | TV calls this on launch; primes the voice + sets match meta |
| GET | `/healthz` | mode, live flag, score, clip count |

## Config (env, all optional)

| var | default | effect |
|---|---|---|
| `NARRATOR_PORT` | `8790` | listen port |
| `TV_EVENTS_URL` | `http://127.0.0.1:3100/api/events` | where events are forwarded |
| `NARRATOR_PUBLIC_URL` | `http://localhost:8790` | base URL the browser uses for audio (set to a public host if the TV is remote) |
| `NARRATOR_MODEL` | `gpt-5.3-chat-latest` | the OpenAI play-by-play model |
| `NARRATOR_MAX_WORDS` | `22` | max words per line (cadence) |
| `NARRATOR_LINE_GAP_MS` | `180` | breath between lines |
| `ELEVEN_MODEL` | `eleven_flash_v2_5` | lowest-latency streaming TTS model |

## Test

```bash
.venv/bin/python -m narrator.test_narrator   # offline, stubs the network (29 checks)
```
