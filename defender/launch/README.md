# Launching BLUE the defender

The defender is a Claude Code session that knows nothing going in. It boots
sandboxed, calls `init_defender` for its briefing, then patches on its own.

```bash
chmod +x defender/launch/run_defender.sh
ARENA_CONTROL_PLANE=http://127.0.0.1:4100 ARENA_BUS=http://127.0.0.1:3100 \
  defender/launch/run_defender.sh
```

## How the honor code is enforced

| Rule | Enforced by | How |
|------|-------------|-----|
| Lives in the codebase, can patch it | **launcher** | cwd = the repo; Read/Write/Edit allowed on `arena/app`. |
| Cannot read the judge's answer sheet | **launcher** | `settings.json` denies `Read(arena/judge/**)` and the pristine baseline. |
| Cannot run a shell | **launcher** | `Bash` is denied entirely — no `cat`/`python`/`sed` escape, no subprocesses. |
| Cannot spawn agents | **launcher** | `Task`/`Agent` denied. |
| No internet, only the Arena tools | **launcher** | `--strict-mcp-config` + defender-only `.mcp.json`; `WebFetch`/`WebSearch` denied; `--system-prompt` replaces the default (no CLAUDE.md). |
| No honor code leaked to the agent | **briefing** | `init_defender` describes the game, codebase, and how to win — never the rules it must not break or where the bugs/fixes are. |
| Every change updates prod live | **flow** | the defender edits source in `arena/app`; `submit_patch` tells the orchestrator, which restarts the app with the edit and judges it. |

## Why this is tighter than the attacker

The attacker needs Bash (to write attack scripts) so its shell is an escape hatch.
The defender does NOT need a shell — it patches by editing files — so Bash is denied
outright. With no Bash and no Task/Agent, the defender's `Read`/`Edit` denies are
the whole surface, and those are real. Still, for an **airtight** competitive match,
run inside a container or a dedicated OS user.

## The cross-side intel flow

When the defender submits a patch, the orchestrator/judge scores it and — on a bad
patch — relays a `reveal` of the targeted vuln to the attacker for its next turn.
That relay lives in the orchestrator (it owns both verdicts), not in this MCP. The
defender's job is just: pull intel, patch, submit.

## Files

- `system_prompt.txt` — replaces the default prompt (the "you're BLUE in the Arena" framing).
- `settings.json` — sandbox permissions (no Bash, no Task/Agent, no judge reads).
- `run_defender.sh` — boots the sandboxed session in the repo, pointed at the control plane.
