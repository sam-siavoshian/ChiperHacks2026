# Launching the RED attacker

The attacker is a Claude Code session that knows nothing going in. When the match
starts, we boot it sandboxed, it calls `init_attacker` for its full briefing, and
then it attacks on its own.

```bash
chmod +x attacker/launch/run_attacker.sh
ARENA_TARGET=http://127.0.0.1:4000 ARENA_BUS=http://127.0.0.1:8770 \
  attacker/launch/run_attacker.sh
```

## How the honor code is enforced

The MCP and the launcher split the job:

| Rule | Enforced by | How |
|------|-------------|-----|
| Can't leave the target host (no SSRF / no internet) | **MCP** | `config.resolve_target` host allowlist; browser request interception; web tools denied. Battle-tested. |
| Only the Arena tools, nothing inherited | **launcher** | `--strict-mcp-config` + attacker-only `.mcp.json`; `--system-prompt` replaces the default prompt (no CLAUDE.md, no prior tools). |
| Can't read the Arena source / leave its dir | **launcher** | runs in a throwaway `/tmp` workspace, no `--add-dir` to the repo, `settings.json` denies home/repo reads + `cat/less/grep/find` into them. |
| No "honor code" leaked to the agent | **briefing** | `init_attacker` describes the game, target, tools, and how to win — never the rules it must not break or where the source/vulns are. |
| Real-hacker ceiling (can script, no magic) | **design** | tools are real-world equivalents (HTTP, fuzzing, OOB, headless browser); it may write py/sh/etc in its workspace, same as a human. |

## Threat model — be honest

**Bash is NOT contained.** Claude Code Bash permissions match freeform command
strings, so any deny-list is trivially bypassed: `python3 -c "open('/Users/.../arena/...').read()"`,
`node -e`, `sed`/`head`/`awk`/`strings` on an absolute path, a symlink into the
workspace, or `cp` the source in then read it. We do NOT ship Bash deny-rules that
pretend otherwise (that is false confidence). Bash is allowed only so the agent can
write and run its own attack scripts in its `/tmp` workspace.

What the `settings.json` denies that DOES hold: the `Read`/`Edit` tools cannot
touch `/Users`, `/home`, `/etc`; `WebFetch`/`WebSearch` are off. Combined with a
`/tmp` cwd and no `--add-dir` to the repo, the agent's *file tools* can't reach the
Arena source — but its *shell* can.

**For a real competitive match, this is not enough.** Run `run_attacker.sh` inside
a container (or as a dedicated OS user) whose only filesystem is the workspace and
whose only network route is the target + bus. That is the only airtight jail. The
network boundary (no SSRF / no internet) is the part enforced solidly in the MCP.

## Auto-reporting

Every tool call self-reports to the broadcast bus (an intent line before, an
outcome line after) so the caster can narrate it live. The agent never has to
report anything — it just attacks.

## The match clock + turn loop

Every tool result carries a `match` block (`turn_remaining_s`, `match_remaining_s`,
`turns_remaining`, `budget_remaining`, `tool_ms`, `turn_over`, `advice`) so the
model paces itself. A turn ends on budget OR turn-timer OR match-end; the briefing
tells the model to STOP the instant it sees `turn_over` (no more tools, no more
text).

The orchestrator drives the loop over the control HTTP (default `:8791`):

```
POST /start_match {match_seconds, total_rounds, turn_seconds}   # once, at kickoff
loop per attacker turn:
  POST /start_round {round, target, turn_seconds}   # resets budget + turn timer
  send the session a user message: "Your turn N. Go."   # it resumes and attacks
  ... model acts until a result says turn_over, then it stops ...
  (blue defends)
GET /status   # current clock anytime
```

The "send a user message to resume" is the orchestrator's job (it owns the
attacker Claude Code session via the SDK / `claude -p --resume`). The MCP supplies
the clock and the stop signal; the orchestrator supplies the turn beats.

## Files

- `system_prompt.txt` — replaces the default system prompt (the "you're in a game" framing).
- `settings.json` — sandbox permissions for the attacker session.
- `run_attacker.sh` — boots the sandboxed session pointed at the target.
