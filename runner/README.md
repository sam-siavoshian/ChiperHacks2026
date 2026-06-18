# Arena Match Runner

The conductor. It boots the arena, spawns both Claude Code sessions, drives the
turns, sets each side's clock, and frames the broadcast — the piece that turns the
attacker MCP + defender MCP + judge + TV into an actual match.

## Run the stack — start matches from the dashboard, not the terminal

```bash
# 1. the TV dashboard (:3100)
cd tv && bun install && bun run dev

# 2. the match runner SERVICE (:8799) — the TV's LAUNCH button calls this
python -m runner.server
#    token-free demo (scripted real exploit + patch, no model spend):
#    ARENA_MOCK_AGENTS=1 python -m runner.server
```

Then open `http://127.0.0.1:3100`, pick the models, and click **LAUNCH MATCH**.
That's it — every match after is started, watched, and stopped from the dashboard.
The service boots the control plane (:4100) + the HTTP MCPs on the first match.

Frontend wiring (all proxied to the runner service):

```
TV LAUNCH  -> POST /api/match/start  -> runner :8799 /match/start  (boots arena, spawns RED+BLUE, runs the match)
TV stop    -> POST /api/match/stop   -> runner :8799 /match/stop
TV status  -> GET  /api/match/status -> runner :8799 /match/status
events     -> every producer POSTs the TV ingest /api/events -> SSE /api/stream -> browser
```

## Or from the CLI

```bash
python -m runner                 # full match, real Claude sessions
python -m runner --rounds 3 --turn-seconds 40
python -m runner --no-orchestrator   # reuse a control plane already on :4100
```

## What it does

1. **Boots services** (`processes.py`): the control plane / judge (`arena/orchestrator`
   on :4100, which starts the app on :4000) and the two MCPs as persistent
   **HTTP** services (attacker :8811, defender :8812). HTTP transport so each
   MCP's control surface + match clock outlive any one session.
2. **Spawns sessions** (`session.py`): `claude -p` headless per side, with that
   side's sandbox (system prompt, HTTP MCP config, settings) and a fixed session
   id so turns RESUME the same context. Each turn is wall-clock bounded.
3. **Drives turns** (`match.py`): the orchestrator runs with turn-enforcement off;
   the runner is the single driver, so only one side acts at a time. Per turn it
   sets the side's MCP clock (`/start_round`), frames the turn on the bus
   (`round_start` / `timer` / `handoff`), runs the session, then reads the
   authoritative board and emits `score.update`. RED gets intel on what BLUE has
   secured; BLUE pulls the area hint via `get_intel`.
4. **Sends to TV**: match-framing events go to the bus (`ARENA_BUS` + path). The
   orchestrator emits the scoring + `round_end` events; the MCPs emit tool-level
   narration. Three layers, one broadcast.
5. **Tears everything down** on exit.

## Turn model

The orchestrator swaps turn + resets the app to pristine after **every** scoring
move, and the board (the score) persists. So one session-turn = one move: RED does
recon then lands ONE exploit (`claim_exploit` → judge `/claim`); BLUE reads the
targeted area, patches the source, and submits ONE patch (`submit_patch` → judge
`/patch`). A patch counts only if the exploit dies AND the feature lives.

## Components

- `config.py` — ports, match shape, models, lifecycle toggles.
- `clients.py` — control-plane / MCP-control / TV HTTP clients + envelopes.
- `processes.py` — start/health-wait/stop the orchestrator + HTTP MCPs.
- `session.py` — drive one side's `claude` session (real) or a mock (tests).
- `match.py` — the turn loop.
- `selftest.py` — a real 1-round match with MOCK agents against the live judge.

## Verify

```bash
python -m runner.selftest
```

Boots the real orchestrator, runs a full round with scripted agents (RED lands the
login SQLi and claims it; BLUE parameterizes the query and patches it), and asserts
turn alternation, live scoring, and the broadcast framing. Current: **7/7**.

The real-Claude path is proven separately: a live `claude -p` session connects to
the HTTP MCP, calls `init_attacker`, and runs a turn. A full match spawns two model
sessions across all rounds — that costs real tokens, so run `python -m runner` when
you want the live show.

## Config (env)

`ARENA_CONTROL_PLANE` (:4100), `ARENA_ATTACKER_MCP_PORT`/`ARENA_DEFENDER_MCP_PORT`
(8811/8812; the control routes live on the same port in HTTP mode), `ARENA_BUS` +
`ARENA_BUS_EMIT_PATH`, `ARENA_TOTAL_ROUNDS`, `ARENA_TURN_SECONDS`, `ARENA_TURN_GRACE`,
`ARENA_RED_MODEL`/`ARENA_BLUE_MODEL`, `ARENA_START_ORCH`/`ARENA_START_MCPS`,
`ARENA_RUNNER_PORT` (service, 8799), `ARENA_MOCK_AGENTS` (1 = scripted agents).

The bus defaults to the TV ingest (`http://127.0.0.1:3100/api/events`) so the
dashboard always gets events. To route through the narrator (live commentary +
TTS), set `ARENA_BUS=http://127.0.0.1:8790 ARENA_BUS_EMIT_PATH=/emit` and run the
narrator (it forwards to the TV).
