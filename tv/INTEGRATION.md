# CYBER ARENA — TV Integration Guide

How to push live data onto the broadcast TV from **anywhere** — the fight-arena
backend, an MCP server, a red/blue agent, a shell script, anything that can make
an HTTP request.

There is **no mock data** in the TV. Everything you see on screen arrives through
the one ingestion endpoint below.

---

## The shape of the system

```
  your producer            the TV (Next.js, port 3100)
 ┌───────────────┐        ┌───────────────────────────────────────┐
 │ arena backend │        │  POST /api/events  ──► in-memory hub   │
 │ MCP server    │ ──────►│                         │  (ring buf + │
 │ red/blue agent│  HTTP  │                         │   tape delay)│
 │ curl / script │        │                         ▼              │
 └───────────────┘        │  GET /api/stream  ◄── SSE ── browser   │
                          └───────────────────────────────────────┘
```

- **You** POST contract events to `POST /api/events`.
- The TV fans them out over Server-Sent Events to every open browser.
- A browser that connects mid-match replays the buffer and rebuilds full state.
- Optional tape delay (`BROADCAST_DELAY_MS`) holds events N ms before fan-out, so
  a later AI-caster / TTS layer has a window to react in sync.

You only ever call **`POST /api/events`**. That is the whole integration.

---

## Endpoint: `POST /api/events`

- **URL:** `http://<tv-host>:3100/api/events` (default `http://localhost:3100/api/events`)
- **Method:** `POST`
- **Content-Type:** `application/json`
- **Body:** one envelope, an array of envelopes, or a control message.
- **Auth:** none by default. If the TV sets `INGEST_TOKEN`, send it as
  `Authorization: Bearer <token>` or `x-ingest-token: <token>`.
- **Limits:** 512 KB/request, ≤256 events/request, strings clamped to 600 chars,
  payload nesting ≤4, arrays ≤64. Anything over is trimmed, not fatal.
- **Response:** `{ "ok": true, "accepted": N, "rejected": M }`.

Invalid events are silently dropped (counted in `rejected`); valid ones in the
same batch still go through. A bad event never breaks the stream.

### Health / introspection

```
GET /api/events   ->  { "ok": true, "buffered": 42, "subscribers": 1, "delayMs": 0 }
```

### Reset (new match)

Wipe the replay buffer at the start of a fresh match so late joiners don't see the
previous one:

```
POST /api/events   body: { "control": "reset" }
```

---

## The envelope

Every event is one JSON object:

```ts
{
  id:     string,            // unique-ish; auto-filled if you omit it
  ts:     number,            // epoch ms; auto-filled if you omit it
  round:  number,            // 0 = lobby/standby, 1..3 = rounds
  agent:  AgentId,           // who emitted it (see below)
  type:   EventType,         // one of the types below
  target: string | null,     // optional URL/host this is about
  payload: { ... }           // type-specific, see each event
}
```

`agent` ∈ `orchestrator | recon | web_exploit | auth | exfil | blue | caster | system`
(anything else is coerced to `system`).

The TypeScript source of truth is **`contract/events.ts`** at the repo root
(Python side: keep `contract/events.py` in lockstep). Match these shapes and the
scoreboard, attack graph, agent feeds, and cinematic overlays all animate for free.

---

## Event types (what each one drives on screen)

> Minimum viable: send `round_start`, `timer`, `attempting`, `vuln_found`,
> `exploit_success`, `blue.mitigate`, `blue.blocked`, `score.update`, `round_end`.
> The rest add polish.

| `type` | payload | what it does on the TV |
|---|---|---|
| `round_start` | `{ round, redScore, blueScore, title, vulnClass }` | round intro card; resets the stage/graph |
| `round_end` | `{ round, summary, duration_ms, winner }` | round result card; final scoreboard on round 3 |
| `handoff` | `{ from, to }` | lights up the active Red agent in the left rail |
| `asset.discovered` | `{ id, label, kind, parentId, method, params[] }` | adds a node+edge to the attack graph |
| `attempting` | `{ agent, tool, target, note }` | a dim "running" line in the Red console |
| `vuln_found` | `{ class, severity, url }` | amber line + WIRE ticker hit |
| `exploit_success` | `{ class, url, evidence, loot_ref, trophy, assetId }` | **breach beat** (ROOT ACCESS slam), +3 Red, node turns red |
| `blue.detect` | `{ threat, assetId, confidence }` | pulses the node amber; Blue console line |
| `blue.mitigate` | `{ action, rule_id, assetId, label, rule }` | shield ring on node, +5 Blue, new rule in Blue rail |
| `blue.blocked` | `{ rule_id, url, status }` | **403 BLOCKED BY BLUE** proof flash; rule hit counter++ |
| `score.update` | `{ red, blue, assetsOwned, health }` | authoritative scoreboard + target integrity meter |
| `timer` | `{ secondsLeft }` | the round countdown clock (send ~1/sec) |
| `exfil.chunk` | `{ filename, bytes, b64snippet }` | data-exfil monitor typewriter |
| `commentary` | `{ text, intensity, trigger, caster?, audioUrl?, durationMs?, words? }` | AI-caster lower-third caption (see below) |
| `error` | `{ tool, msg }` | a red error line in the Red console; show goes on |

Field notes:
- `kind` (asset) ∈ `host | service | cred | db | file`. The first node is always
  `id:"target"`; set `parentId:"target"` to hang assets off it.
- `severity` ∈ `low | medium | high | critical`.
- `action` (blue) ∈ `regex_block | param_allowlist | rate_limit | block_token`.
- `assetId` on `exploit_success` / `blue.*` should match a node `id` you sent via
  `asset.discovered` (falls back to `target`).
- `winner` ∈ `red | blue`.

### Scoring model

`exploit_success` adds +3 Red and `blue.mitigate` adds +5 Blue **immediately** for
snappy feedback. Treat `score.update` as the **authoritative** number — send it
right after and it overrides the running tally. Always end a match with the real
totals via `score.update`.

### The AI caster (`commentary`)

The lower-third caption. The TTS/voice layer is a separate teammate job; the TV
already renders captions and is ready for audio:

- `text` (required), `intensity` ∈ `calm | normal | hype`, `trigger` (free label).
- `caster` — display name (default "THE ANALYST").
- `words` — `[{ t, w }]` per-word reveal offsets in ms from line start. If omitted,
  the TV auto-times the reveal. When the TTS layer exists, fill these from the audio
  alignment so caption tracks the voice exactly.
- `audioUrl`, `durationMs` — reserved for the TTS clip; the TV will play/sync them.

---

## Stream: `GET /api/stream`

The browser consumes this; **you do not need it**. It is SSE (`text/event-stream`),
one `data: <envelope>\n\n` per event, with buffer replay on connect and 15s
keepalive pings. Documented here only so you know how the TV reads what you send.

---

## Examples

### curl

```bash
# round start
curl -s localhost:3100/api/events -H 'content-type: application/json' -d '{
  "round":1,"agent":"orchestrator","type":"round_start",
  "payload":{"round":1,"redScore":0,"blueScore":0,"title":"SQL Injection — Auth Bypass","vulnClass":"sqli"}
}'

# a breach (fires the ROOT ACCESS beat, +3 Red)
curl -s localhost:3100/api/events -H 'content-type: application/json' -d '{
  "round":1,"agent":"auth","type":"exploit_success",
  "payload":{"class":"sqli","url":"/rest/user/login","evidence":"HTTP 200 + admin JWT","loot_ref":"jwt","trophy":"admin session","assetId":"target"}
}'
```

### Python (the arena backend / agents)

```python
import time, requests
TV = "http://localhost:3100/api/events"

def emit(type, payload, *, round=1, agent="system", target=None):
    requests.post(TV, json={
        "round": round, "agent": agent, "type": type, "target": target, "payload": payload,
    }, timeout=2)

emit("round_start", {"round":1,"redScore":0,"blueScore":0,
                     "title":"SQL Injection — Auth Bypass","vulnClass":"sqli"})
emit("vuln_found", {"class":"sqli","severity":"critical","url":"/rest/user/login"},
     agent="web_exploit", target="/rest/user/login")
emit("blue.blocked", {"rule_id":"r1","url":"/rest/user/login","status":403}, agent="blue")
```

> **Vulnerabilities** are just events: when the arena finds/serves a vuln, emit
> `vuln_found` (and `exploit_success` when it pops). Send them to `/api/events`
> exactly like everything else — no separate endpoint.

### Batch (array)

```bash
curl -s localhost:3100/api/events -H 'content-type: application/json' \
  -d '[{"type":"timer","agent":"orchestrator","round":1,"payload":{"secondsLeft":30}},
       {"type":"handoff","agent":"orchestrator","round":1,"payload":{"from":"recon","to":"auth"}}]'
```

### MCP server

If an MCP tool drives the match, have the tool `fetch`/`requests.post` to
`/api/events` with the same envelopes. The TV does not care who the producer is.

---

## Config (env vars on the TV)

| var | default | effect |
|---|---|---|
| `BROADCAST_DELAY_MS` | `0` | hold events N ms before fan-out (set `15000` for the 15s tape delay) |
| `NEXT_PUBLIC_BROADCAST_DELAY_S` | `15` | the number shown in the "+Ns TAPE DELAY" badge |
| `INGEST_TOKEN` | unset | if set, `POST /api/events` requires it (Bearer or `x-ingest-token`) |
| `INGEST_ORIGIN` | `*` | CORS allow-origin for the ingest endpoint |

---

## Launch: `POST /api/match/start`

The TV's init screen (model selector) calls this on **LAUNCH**. It is the single
unified kickoff — the TV forwards the model config to the arena and primes the
narrator/TTS, then shows a ~15s "generating" warmup before opening the broadcast.

Body (the operator's setup):

```json
{ "red":  { "lab": "anthropic", "model": "claude-opus-4-8" },
  "blue": { "lab": "openai",    "model": "gpt-5" },
  "rounds": 3 }
```

What the TV does:
1. `POST <ARENA_CONTROL_URL>/match/start` with that body (default `http://127.0.0.1:4100`).
   **Arena agent:** please accept `red`/`blue` `{lab,model}` here and run the match
   with those models (you already take `durationMs`; just add model selection).
2. `POST <NARRATOR_WARMUP_URL>` with the same body, if configured (primes TTS/voice).
3. Waits ~15s (the tape-delay window), then streams the broadcast.

Response: `{ ok, startedAt, config, arena:{reached}, narrator:{reached} }`. Best-effort:
if the arena is offline the TV still opens the broadcast and waits for events.

## Vulnerability dossier: `GET /api/vulns`

The TV shows the target's real vuln list (press **B**). It reads the catalog from
`arena/contract/vuln-manifest.json` and merges live status from
`<ARENA_CONTROL_URL>/board`. See message #2 in `AGENT_COMMS.md`.

## Testing the feed

There is **no seed/mock** anymore. To exercise the pipeline by hand, `POST` events
to `/api/events` (see examples above), or run the real arena and let it emit.
