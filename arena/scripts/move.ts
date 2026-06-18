// Thin client for the Arena control plane. Reference for the attacker/defender
// MCP sessions and handy for manual play.
//
//   bun run scripts/move.ts start            # begin a match
//   bun run scripts/move.ts state            # board + score + whose turn
//   bun run scripts/move.ts hint             # area Red is targeting (defender)
//   bun run scripts/move.ts attack <vulnId>  # Red move
//   bun run scripts/move.ts patch  <vulnId>  # Blue move (edit source first!)
//   bun run scripts/move.ts stop

const CONTROL = process.env.ARENA_CONTROL ?? "http://127.0.0.1:4100";

async function call(method: string, path: string, body?: any) {
  const r = await fetch(CONTROL + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}

const [cmd, arg] = process.argv.slice(2);

let res;
switch (cmd) {
  case "start":
    res = await call("POST", "/match/start", {});
    break;
  case "state":
    res = await call("GET", "/state");
    break;
  case "hint":
    res = await call("GET", "/hint");
    break;
  case "attack":
    res = await call("POST", "/attack", { vulnId: arg });
    break;
  case "patch":
    res = await call("POST", "/patch", { vulnId: arg });
    break;
  case "stop":
    res = await call("POST", "/match/stop", {});
    break;
  default:
    console.error("usage: move.ts start|state|hint|attack <id>|patch <id>|stop");
    process.exit(1);
}

console.log(JSON.stringify(res!.data, null, 2));
process.exit(res!.status >= 400 ? 1 : 0);
