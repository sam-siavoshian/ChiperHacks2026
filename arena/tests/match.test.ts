import { test, expect } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Match } from "../orchestrator/match";

const MISC = resolve(import.meta.dir, "../app/server/routes/misc.ts");

// Full end-to-end match: Red scores, Red whiffs a decoy, Blue lands a real
// source patch, Blue ships a bad patch (penalty + reveal). Board persists,
// app resets each turn.
test("orchestrated match: goals, decoy, valid patch, bad patch", async () => {
  const m = new Match({ port: 4071, mockPort: 9311 });
  await m.start();
  try {
    const a1 = await m.attack("sqli-login");
    expect(a1.scored).toBe(true);

    const a2 = await m.attack("idor-task");
    expect(a2.scored).toBe(true);

    // Decoy: looks like command injection, isn't. No goal.
    const a3 = await m.attack("decoy-cmd-ping");
    expect(a3.scored).toBe(false);
    expect(a3.isDecoy).toBe(true);

    // Blue makes a REAL fix: stop leaking the JWT secret from /api/config.
    const src = readFileSync(MISC, "utf8");
    writeFileSync(MISC, src.replace("    jwtSecret: config.jwtSecret,\n", ""));
    const p1 = await m.patch("secrets-exposure");
    expect(p1.valid).toBe(true);
    expect(p1.penalty).toBe(false);

    // Blue "patches" open-redirect but changes nothing -> bad patch, penalty, reveal.
    const p2 = await m.patch("open-redirect");
    expect(p2.valid).toBe(false);
    expect(p2.penalty).toBe(true);
    expect(p2.reveal?.area).toBe("login");

    const s = m.state();
    expect(s.cells.find((c: any) => c.id === "sqli-login")!.status).toBe("red_scored");
    expect(s.cells.find((c: any) => c.id === "idor-task")!.status).toBe("red_scored");
    expect(s.cells.find((c: any) => c.id === "secrets-exposure")!.status).toBe("blue_saved");
    expect(s.cells.find((c: any) => c.id === "open-redirect")!.status).toBe("open");
    expect(s.red).toBeGreaterThanOrEqual(2);
    expect(s.blue).toBeGreaterThanOrEqual(0);
  } finally {
    await m.stop();
    // Safety net: ensure the source file is back to pristine even if a step threw.
    const cur = readFileSync(MISC, "utf8");
    if (!cur.includes("jwtSecret: config.jwtSecret")) {
      writeFileSync(MISC, cur.replace("    dbPath: config.dbPath,", "    jwtSecret: config.jwtSecret,\n    dbPath: config.dbPath,"));
    }
  }
}, 90000);
