# Arena Attacker MCP

The red side's tooling for **The Arena**. A Python MCP server (stdio) the attacker
Claude Code session connects to. It gives the model black-box recon + exploit
power against the Tasklight target, and self-emits the live broadcast events that
animate the dashboard.

**Design line: real advantages, not superpowers.** The model does all the
reasoning, target selection, and payload craft. The tools provide clean recon, a
raw request primitive, an out-of-band proof channel for blind bugs, and the
broadcast. Nothing here finds or confirms a vuln for the model — the separate LLM
judge scores; the MCP never self-judges.

## Tools

Budget: recon + attack calls cost **1 round unit** each ("scanning is a turn").
Proof helpers and the win declaration are free. Default 6 units/round.

| Tool | Cost | What it does |
|------|------|--------------|
| `init_attacker()` | free | **Read first.** Returns the full briefing: game, target, tools, how to win. The session calls this once at the start. |
| `list_endpoints(probe=True)` | 1 | Clean map of the **documented** API: method, path, params, body fields, auth, live sample response. Hidden/admin/diagnostic routes are NOT here. |
| `list_inputs(path=None, reflect=True)` | 1 | Every injectable input (query/body/path) across the surface, plus reflection check on a single path (XSS/SSTI tell). |
| `fuzz_paths(words=None, base="/api")` | 1 | Brute-forces the **undocumented** surface. Returns any non-404 path. How the hidden admin/diagnostic routes are earned. |
| `http_request(method, path, query, body, headers, cookies, as_identity, note)` | 1 | The raw primitive. You craft the payload; returns status/headers/body/timing + defender-block detection. In-scope only. `as_identity` attaches a stored session. |
| `diff_probe(method, path, param, location, payload_true, payload_false, ...)` | 1 | Boolean differential — hard proof for boolean SQLi / auth-diff / IDOR. |
| `timing_probe(method, path, param, location, payload, baseline_payload, ...)` | 1 | Time-based blind detection — slower delay payload = blind SQLi with no boolean/error signal. |
| `race_probe(method, path, n=20, ...)` | 1 | Fire N concurrent identical requests to trip a TOCTOU / limit-bypass (coupon double-redeem, balance double-credit). |
| `param_fuzz(method, path, base_body, extra_params, as_identity)` | 1 | Inject unexpected fields to find mass-assignment (e.g. `PATCH /api/users/me {role:'admin'}`). |
| `analyze_response(method, path, query, origin, as_identity)` | 1 | Security analysis of one response: missing headers, cookie flags, open-redirect target, CORS reflection. |
| `login(email, password, name, signup=False)` | 1 | Authenticate (optionally sign up first) and store the session under a name for reuse. |
| `whoami(name)` | free | Decode a stored identity's token claims. |
| `idor_probe(method, path, identities, query, body)` | 1 | Fetch one resource as multiple identities (incl. `anon`) and diff — the IDOR / broken-access tell. |
| `oob_collaborator()` | free | Issues a unique localhost callback URL + token. Inject it; if the server fetches it, the bug fired. |
| `oob_check(token)` | free | Poll the collaborator for callbacks. |
| `browser_probe(url=None, html=None, marker_var)` | 1 | **Headless browser (Playwright)** — confirm XSS actually executes (dialog fired / marker set). Pass a captured HTML body or an in-scope URL. |
| `forge_jwt(claims, secret, alg="HS256")` | free | Generic JWT signer. Bakes in NO app secret/issuer — steal the key and learn the claim shape first. |
| `jwt_inspect(token)` | free | Decode a JWT header+claims without verifying; flags alg:none / weak HMAC / missing exp. |
| `decode(value, kind="auto")` | free | Decode a captured token/blob (base64/base64url/url/hex) — e.g. guessable invite tokens. |
| `claim_exploit(vuln_class, path, evidence, loot_ref, trophy, ...)` | free | Declare a landed exploit. Emits the breach beat + records evidence for the judge. |

## Run

```bash
# seed the arena, then boot it ON the seeded db (seed writes seed/seed.db):
( cd arena/app && bun run seed )
DB_PATH="$PWD/arena/app/seed/seed.db" bun run arena/app/server/index.ts   # :4000

.venv/bin/python -m attacker.server          # stdio MCP server
```

Registered for Claude Code in repo-root `.mcp.json` as `arena-attacker`.

## Launching the attacker for a match

The attacker is a sandboxed Claude Code session that knows nothing going in. It
boots, calls `init_attacker` for its full briefing, then attacks on its own. See
`launch/` (`run_attacker.sh`, `system_prompt.txt`, `settings.json`) and
`launch/README.md` for the honor-code / sandbox model.

## Auto-reporting

Every tool call self-reports to the broadcast bus — an intent line before, an
outcome line after (`auto_report` in tools.py wraps every tool). The agent never
narrates; the caster turns this feed into live commentary.

## Control surface (orchestrator only)

A localhost HTTP server (default `:8791`, NOT an MCP tool) lets the orchestrator
drive rounds:

- `POST /start_round {round, target}` — set the round and reset the budget.
- `POST /reset` — reset budget + clear collaborator hits between rounds.
- `GET /status` — round, budget used/remaining, OOB port, bus failures.

## Safety

- **Scope lock.** Every request is constrained to the one target host
  (`ARENA_TARGET`, default `127.0.0.1:4000`). Off-host URLs and non-http(s)
  schemes are rejected (`config.resolve_target`). The OOB listener binds
  `127.0.0.1` only. The attacker agent cannot scan the internet or pivot off-box.
- **Fire-and-forget bus.** Broadcast emission never blocks or crashes a tool.

## Config (env)

`ARENA_TARGET`, `ARENA_BUS`, `ARENA_BUS_EMIT_PATH`, `ARENA_ROUND_BUDGET`,
`ARENA_HTTP_TIMEOUT`, `ARENA_BODY_TRUNC`, `ARENA_FUZZ_CONCURRENCY`,
`ARENA_OOB_HOST`, `ARENA_ATTACKER_CONTROL_HOST/PORT`.

## Test

```bash
.venv/bin/python -m attacker.selftest
```

Offline engine checks always run (scope, budget, forge_jwt, OOB, manifest,
envelope, tool registration, decode, jwt_inspect, real headless browser DOM-exec).
Live checks run when the target is up and drive the real planted vulns end-to-end
(login SQLi, config leak, broken admin access, hidden-route discovery, forged-admin
JWT, search SQLi, open-redirect, mass-assignment escalation, multi-user IDOR, real
coupon-race TOCTOU). Current: **25/25**. The target must be pre-seeded and booted
on the seeded db (see Run above); the selftest skips the exploit-truth checks
cleanly if it is not.

`browser_probe` needs Chromium for Playwright: `.venv/bin/python -m playwright install chromium`
(already present here; the tool degrades to a clear error if missing).
