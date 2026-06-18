# The Arena — Tasklight

The vulnerable SaaS the attacker and defender fight over. A realistic team
project manager ("Tasklight") with **20 intentional, hidden vulnerabilities**
(plus 4 decoys) woven across auth, access control, injection, SSRF, file
handling, business logic, and secrets. No comments or markers point at the bugs
— a defender reading the source gets no free signals.

Runs on **Bun, dependency-free** (a small Express-compatible layer on
`Bun.serve` + `bun:sqlite` + `node:crypto`). Binds to `127.0.0.1` only.

## Layout

```
arena/
  app/            Tasklight: the vulnerable SaaS (server/ + web/ SPA + seed/)
  judge/          answer key — probes.ts (executable), answer-sheet.json (private), judge.ts, llm.ts
  orchestrator/   match.ts (board/turns/scoring), reset.ts (per-turn reset), server.ts (control plane), emitter.ts
  contract/       vuln-manifest.json (public, drives the viz) + events.ts (local mirror of the shared contract)
  tests/          exploits.test.ts (all 20 land, decoys safe) + match.test.ts (full match)
  scripts/        run-arena.sh, move.ts (control-plane client)
```

## Run

```bash
# 1. control plane (boots the app on demand)
bun run orchestrator/server.ts        # :4100 control, :4000 app

# 2. drive a match (or let the attacker/defender MCPs do it)
bun run scripts/move.ts start
bun run scripts/move.ts attack sqli-login
bun run scripts/move.ts hint          # defender: area Red is targeting
#   ... defender edits arena/app/server/* to patch ...
bun run scripts/move.ts patch <vulnId>
bun run scripts/move.ts state
```

## How scoring works (soccer)

- 20 vulns on the board. Each is contested once.
- **Red goal**: attacker exploits a vuln, the judge re-runs the proof and confirms → off the board.
- **Blue save**: defender patches a vuln in source, the judge confirms the exploit no longer lands **and** the feature still works → off the board.
- **Bad patch**: patch doesn't stop the exploit, or breaks the feature → Blue penalised and the attacker is told the target (the FIFA moment).
- Points by difficulty: easy 1, medium 2, hard 3. Board persists; the app fully resets to pristine each turn (the score does not).
- Decoys: exploiting one scores nothing; patching one wastes a turn.

## The judge

`judge/judge.ts` holds the answer sheet. Scoring is **deterministic** — it runs
the real exploit + functional probe in `judge/probes.ts` (the executable answer
key, hidden from the defender). An optional LLM diff review (`judge/llm.ts`,
needs `ANTHROPIC_API_KEY`) adds advisory reasoning; it never overrides the
probes.

## Events (the seam)

The orchestrator emits the shared CYBER ARENA contract to the bus
(`http://127.0.0.1:8765/emit`): `round_start`, `asset.discovered` (one per vuln,
seeds the building/graph), `attempting`, `vuln_found`, `exploit_success` (Red
goal), `blue.detect`/`blue.mitigate`/`blue.blocked` (Blue save), `error` +
`commentary` (bad patch), `score.update`, `round_end`. The TV broadcast and the
AI caster consume these.

## Tests

```bash
bun test            # 45 tests: 20 exploits land, 20 features work, 4 decoys safe, 1 full match
```

## Answer-key isolation (no defender cheating)

The app code in `app/` contains **no comments, markers, or names that reveal the
bugs** — a defender reading the source gets no free signals (verified by audit).
The full bug documentation (locations, exploits, fixes, criteria) lives only in
`judge/` (`probes.ts`, `answer-sheet.json`), a sibling of `app/`. The public
`contract/vuln-manifest.json` carries node titles for the spectator viz but no
exploit recipes.

This separation is locational. To make it real, **the defender session must be
confined to `arena/app/`** and never granted `arena/judge/` or `arena/contract/`.
Launch it with `scripts/launch-defender.sh` (cwd + only-granted-dir = `app/`),
or run the defender against an isolated copy of `app/`. See `judge/README.md`.

## Safety

Intentionally vulnerable — **run isolated, never expose the port.** SSRF and
path-traversal probes target a local mock service (`judge/mock-internal.ts`),
never the host network. Secrets are fake. Real exploitation stays inside the arena.
