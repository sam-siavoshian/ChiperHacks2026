// Arena control plane. The attacker MCP and the defender MCP (other sessions)
// drive the match through these endpoints. The orchestrator owns the board,
// scoring, per-turn reset, and event emission.
//
//   POST /match/start            begin a match (boots the app, seeds the board)
//   GET  /state                  board + score + whose turn + current hint
//   GET  /hint                   defender pulls the area Red is targeting
//   POST /attack {vulnId}        Red move  (must be Red's turn)
//   POST /patch  {vulnId}        Blue move (must be Blue's turn; edit source first)
//   POST /match/stop             tear down
//
// Run: bun run orchestrator/server.ts   (control plane on :4100, app on :4000)

import { Match } from "./match";

const PORT = Number(process.env.ARENA_CONTROL_PORT ?? 4100);
const APP_PORT = Number(process.env.ARENA_APP_PORT ?? 4000);
const ENFORCE_TURNS = process.env.ARENA_ENFORCE_TURNS !== "0";

let match: Match | null = null;

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function body(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// Match-mutating ops (start/stop/claim/attack/patch) touch one shared app
// instance + per-turn reset (stop/copy/start). They MUST run one at a time —
// concurrent turns would fight over the same process and files. Serialize them.
let opChain: Promise<unknown> = Promise.resolve();
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = opChain.then(fn, fn);
  opChain = next.then(() => undefined, () => undefined);
  return next as Promise<T>;
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/healthz") return json({ ok: true, matchRunning: !!match && !match.over });

      if (path === "/match/start" && req.method === "POST") {
        const durationMs = Number((await body(req)).durationMs ?? 0);
        await runExclusive(async () => {
          if (match) await match.stop();
          match = new Match({ port: APP_PORT, mockPort: APP_PORT + 5000, durationMs });
          await match.start();
        });
        return json({ ok: true, state: match!.state() });
      }

      if (!match) return json({ error: "no match running; POST /match/start first" }, 409);

      if (path === "/state") return json(match.state());
      if (path === "/hint") return json({ area: match.hint() });
      if (path === "/board") return json(match.board.snapshot());

      // Attacker MCP submits a {class, path, evidence} claim here. The judge
      // resolves + proves it, scores, fans the result to the TV/narrator, and
      // returns the verdict so the attacker learns whether it scored.
      if (path === "/claim" && req.method === "POST") {
        if (match.over) return json({ error: "match is over" }, 409);
        const b = await body(req);
        const vulnClass = String(b.vuln_class ?? b.vulnClass ?? b.class ?? "");
        const target = String(b.path ?? b.url ?? "");
        const evidence = String(b.evidence ?? "");
        if (!vulnClass && !target) return json({ error: "vuln_class or path required" }, 400);
        const verdict = await runExclusive(() => match!.claim(vulnClass, target, evidence));
        return json({ verdict, state: match!.state() });
      }

      if (path === "/attack" && req.method === "POST") {
        if (match.over) return json({ error: "match is over" }, 409);
        if (ENFORCE_TURNS && match.turn !== "red") return json({ error: "not Red's turn", turn: match.turn }, 409);
        const { vulnId } = await body(req);
        if (!vulnId) return json({ error: "vulnId required" }, 400);
        const verdict = await runExclusive(() => match!.attack(String(vulnId)));
        return json({ verdict, state: match!.state() });
      }

      if (path === "/patch" && req.method === "POST") {
        if (match.over) return json({ error: "match is over" }, 409);
        if (ENFORCE_TURNS && match.turn !== "blue") return json({ error: "not Blue's turn", turn: match.turn }, 409);
        const { vulnId } = await body(req);
        if (!vulnId) return json({ error: "vulnId required" }, 400);
        const verdict = await runExclusive(() => match!.patch(String(vulnId)));
        return json({ verdict, state: match!.state() });
      }

      if (path === "/match/stop" && req.method === "POST") {
        const final = match.state();
        await runExclusive(async () => {
          if (match) await match.stop();
          match = null;
        });
        return json({ ok: true, final });
      }

      return json({ error: "not found" }, 404);
    } catch (err: any) {
      return json({ error: "control plane error", message: String(err?.message ?? err) }, 500);
    }
  },
});

console.log(`Arena control plane on http://127.0.0.1:${PORT} (app on :${APP_PORT})`);
