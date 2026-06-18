# judge/ — HIDDEN ANSWER KEY. Do not expose to the defender.

This directory is the answer sheet for the Arena. It documents every planted
vulnerability: where it lives, how to exploit it, how to fix it, and the exact
pass/fail criteria. Anyone who can read this directory can cheat the match.

**Contents that must stay secret from the defender (and the attacker):**
- `probes.ts` — the executable answer key (exploit + functional probe per vuln).
- `answer-sheet.json` — location, fix, and patch criteria per vuln.
- `judge.ts` / `llm.ts` — the scoring logic.

The public, defender-safe artifact is `../contract/vuln-manifest.json` — it lists
node ids/areas/difficulty for the spectator visualization and carries **no
exploit recipes, fixes, or criteria**. Even so, it names the vuln classes, so it
is also kept out of the defender's reach.

## The isolation contract (REQUIRED — this is what makes "safe" true)

The defender is a coding-agent session that edits source **in `arena/app/` only**.
It must never be able to read `arena/judge/` or `arena/contract/`.

Locational separation alone is not enforcement. When you launch the defender:

- Confine its working directory and file access to `arena/app/`. Use
  `scripts/launch-defender.sh`, which starts the session with `arena/app` as the
  only granted directory.
- Better still, run the defender against an isolated copy of `app/` so the answer
  key is not even on its filesystem. The orchestrator already keeps a pristine
  copy under `arena/.pristine/app`; mount only that for the defender if you want
  hard isolation.

The attacker is black-box over HTTP and never touches the filesystem, so it
cannot read this directory either — but do not hand it the manifest or this
folder out of band.
