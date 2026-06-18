# Arena Defender MCP

BLUE's thin interface to the match. The defender lives **inside the codebase** and
patches the vulnerable app's source directly with its native file tools. The MCP
only hands it intel, submits patches to the judge, and narrates — it has no
attack/recon tooling.

**Honor code (enforced by the launcher, not the MCP):** the defender stays in the
codebase, cannot read the judge's answer sheet, cannot run a shell, and cannot
spawn agents. See `launch/`.

## Tools

| Tool | Cost | What it does |
|------|------|--------------|
| `init_defender()` | free | **Read first.** Full briefing: the game, the codebase you defend, how to patch, how to win. |
| `get_intel()` | free | The general AREA RED is targeting this turn + the candidate vulns in it (id, title) from the public board. |
| `submit_patch(vuln_id, summary)` | 1 | Submit your source fix. Edit the code FIRST. The judge restarts the app with your edit and confirms the exploit no longer lands AND the feature still works. |
| `get_board()` | free | Live scores, whose turn, which vulns are open/scored/saved. |

The defender **patches by editing source** (`arena/app/server/**`) with Read/Edit/Write
— that is the work; the MCP is just for intel + submission. A patch counts only if
the exploit dies AND the feature lives; a bad patch costs Blue and tips off Red
(the orchestrator relays the reveal to the attacker on its next turn).

## Match clock + stop rule

Every result carries a `match` block (`turn_remaining_s`, `match_remaining_s`,
`turns_remaining`, `budget_remaining`, `tool_ms`, `turn_over`). Once `turn_over` is
true, NOTHING runs (only `init_defender` is exempt) — the same hardened, mutation-
tested gate as the attacker. The orchestrator drives the turn clock via the control
HTTP (default `:8792`): `POST /start_match`, `POST /start_round`, `POST /reset`,
`GET /status`.

## Run

```bash
# orchestrator/control plane must be up on :4100 (it owns turns, scoring, reset)
.venv/bin/python -m defender.server          # stdio MCP server
```

Registered in repo-root `.mcp.json` as `arena-defender`. For a match, launch the
sandboxed blue session with `launch/run_defender.sh`.

## Config (env)

`ARENA_CONTROL_PLANE` (orchestrator, default `:4100`), `ARENA_BUS` + `ARENA_BUS_EMIT_PATH`
(broadcast), `ARENA_APP_DIR` (codebase, default `arena/app`), `ARENA_MANIFEST`
(public board), `ARENA_ROUND_BUDGET`, `ARENA_MATCH_SECONDS`, `ARENA_TURN_SECONDS`,
`ARENA_TOTAL_ROUNDS`, `ARENA_DEFENDER_CONTROL_PORT` (default `8792`).

## Test

```bash
.venv/bin/python -m defender.selftest
```

Fully deterministic (stubbed orchestrator), no live services. Covers registration,
briefing, get_intel/submit_patch/get_board, the match clock in every return, the
clock invariants, the stop-gate, and wrapper safety. Current: **9/9**.
