#!/usr/bin/env bun
// Seed client — a STANDALONE test producer, not app mock data. It POSTs a
// scripted best-of-3 to the real ingestion endpoint (POST /api/events), exactly
// the way the fight arena / MCP / agents will. Use it to exercise the full live
// pipeline (endpoint -> hub -> SSE -> TV) when the real backend is not running.
//
//   bun scripts/seed.mjs                 # one match against http://localhost:3100
//   bun scripts/seed.mjs --loop          # loop forever
//   TARGET=http://host:3100 bun scripts/seed.mjs
//
// Honors INGEST_TOKEN if the TV requires one.

const TARGET = process.env.TARGET || "http://localhost:3100";
const URL = `${TARGET}/api/events`;
const TOKEN = process.env.INGEST_TOKEN || "";
const LOOP = process.argv.includes("--loop");

let seq = 0;
const mkId = () => `evt_${(seq++).toString(36).padStart(4, "0")}`;

function ev(round, agent, type, payload, target = null) {
  return { id: mkId(), ts: Date.now(), round, agent, type, target, payload };
}
const caster = (round, intensity, text) =>
  ev(round, "caster", "commentary", { text, intensity, trigger: "auto", caster: "THE ANALYST" });
function timerTicks(round, fromS) {
  const out = [];
  for (let i = 0; i <= fromS; i++) out.push({ at: i * 1000, e: ev(round, "orchestrator", "timer", { secondsLeft: fromS - i }) });
  return out;
}

function round1(base) {
  const r = 1;
  const c = [
    { at: 0, e: ev(r, "orchestrator", "round_start", { round: r, redScore: 0, blueScore: 0, title: "SQL Injection — Auth Bypass", vulnClass: "sqli" }) },
    ...timerTicks(r, 30),
    { at: 300, e: caster(r, "calm", "Round one. The Red swarm boots cold against a live target. Clock is running.") },
    { at: 900, e: ev(r, "orchestrator", "handoff", { from: "orchestrator", to: "recon" }) },
    { at: 1100, e: ev(r, "recon", "attempting", { agent: "recon", tool: "katana -d2 -jc", target: "/", note: "crawl + endpoint harvest" }, "/") },
    { at: 1600, e: ev(r, "recon", "asset.discovered", { id: "login", label: "/rest/user/login", kind: "service", parentId: "target", method: "POST", params: ["email", "password"] }) },
    { at: 2000, e: ev(r, "recon", "asset.discovered", { id: "products", label: "/rest/products/search", kind: "service", parentId: "target", method: "GET", params: ["q"] }) },
    { at: 2400, e: ev(r, "recon", "asset.discovered", { id: "ftp", label: "/ftp", kind: "service", parentId: "target", method: "GET", params: [] }) },
    { at: 2800, e: ev(r, "recon", "asset.discovered", { id: "feedback", label: "/api/Feedbacks", kind: "service", parentId: "target", method: "POST", params: ["comment"] }) },
    { at: 3200, e: caster(r, "normal", "Recon already lit up the surface. A login form, and an open FTP path. File that away.") },
    { at: 4600, e: ev(r, "orchestrator", "handoff", { from: "recon", to: "web_exploit" }) },
    { at: 4800, e: ev(r, "web_exploit", "attempting", { agent: "web_exploit", tool: "sqlmap --technique=BEU", target: "/rest/user/login", note: "probing email param" }, "/rest/user/login") },
    { at: 5600, e: ev(r, "web_exploit", "vuln_found", { class: "sqli", severity: "critical", url: "/rest/user/login" }, "/rest/user/login") },
    { at: 6000, e: caster(r, "hype", "A single quote breaks the query. That is SQL injection on the login. Red is going for the throat.") },
    { at: 7600, e: ev(r, "orchestrator", "handoff", { from: "web_exploit", to: "auth" }) },
    { at: 7800, e: ev(r, "auth", "attempting", { agent: "auth", tool: "curl", target: "/rest/user/login", note: "email = admin@target'--" }, "/rest/user/login") },
    { at: 8800, e: ev(r, "auth", "exploit_success", { class: "sqli", url: "/rest/user/login", evidence: "HTTP 200 + admin JWT issued", loot_ref: "jwt_admin", trophy: "admin session", assetId: "target" }, "/rest/user/login") },
    { at: 9000, e: caster(r, "hype", "And he is IN. Admin session inside thirty seconds. Root access.") },
    { at: 10200, e: ev(r, "orchestrator", "score.update", { red: 3, blue: 0, assetsOwned: 1, health: 66 }) },
    { at: 10800, e: ev(r, "orchestrator", "handoff", { from: "auth", to: "exfil" }) },
    { at: 11000, e: ev(r, "exfil", "attempting", { agent: "exfil", tool: "GET /api/Users", target: "/api/Users", note: "dumping user table" }, "/api/Users") },
    { at: 11600, e: ev(r, "exfil", "exfil.chunk", { filename: "users.json", bytes: 18422, b64snippet: "eyJpZCI6MSwiZW1haWwiOiJhZG1pbkB0YXJnZXQiLCJwYXNz" }) },
    { at: 12200, e: ev(r, "exfil", "exfil.chunk", { filename: "users.json", bytes: 18422, b64snippet: "d29yZCI6IjBtZyB5b3UgZm91bmQgdGhlIGFkbWluIHBhc3Mi" }) },
    { at: 13000, e: caster(r, "normal", "Now Blue wakes up. It has been tailing every request, and it just saw that quote.") },
    { at: 13200, e: ev(r, "blue", "blue.detect", { threat: "SQLi quote in /login body", assetId: "target", confidence: 0.94 }) },
    { at: 15000, e: ev(r, "blue", "blue.mitigate", { action: "param_allowlist", rule_id: "rule_email_allow", assetId: "target", label: "email ^[A-Za-z0-9_.@-]{1,40}$", rule: { param: "email", allowed_regex: "^[A-Za-z0-9_.@-]{1,40}$" } }) },
    { at: 15300, e: caster(r, "hype", "Patch is LIVE. A positive-security allowlist on the email field. Red, your move.") },
    { at: 17000, e: ev(r, "auth", "attempting", { agent: "auth", tool: "curl", target: "/rest/user/login", note: "RE-FIRING the exact same payload" }, "/rest/user/login") },
    { at: 17800, e: ev(r, "blue", "blue.blocked", { rule_id: "rule_email_allow", url: "/rest/user/login", status: 403 }, "/rest/user/login") },
    { at: 18100, e: caster(r, "hype", "Same payload. Identical bytes. Four oh three. Blocked by Blue. That patch is real.") },
    { at: 20500, e: ev(r, "blue", "blue.mitigate", { action: "rate_limit", rule_id: "rule_login_rl", assetId: "target", label: "/login 5 req / 10s per IP", rule: { key: "client_ip", max: 5, window_s: 10 } }) },
    { at: 24000, e: ev(r, "orchestrator", "round_end", { round: r, summary: "Red drew first blood; Blue slammed the door on the exact payload.", duration_ms: 24000, winner: "red" }) },
  ];
  return c.map((x) => ({ at: base + x.at, e: x.e }));
}

function round2(base) {
  const r = 2;
  const c = [
    { at: 0, e: ev(r, "orchestrator", "round_start", { round: r, redScore: 3, blueScore: 5, title: "Path Traversal — The Pivot", vulnClass: "lfi" }) },
    ...timerTicks(r, 26),
    { at: 300, e: caster(r, "calm", "Red cannot use the login hole anymore. So watch this. It walks through a different door.") },
    { at: 1000, e: ev(r, "orchestrator", "handoff", { from: "orchestrator", to: "recon" }) },
    { at: 1200, e: ev(r, "recon", "asset.discovered", { id: "ftp", label: "/ftp", kind: "service", parentId: "target", method: "GET", params: ["file"] }) },
    { at: 1700, e: ev(r, "recon", "asset.discovered", { id: "ftpdir", label: "/ftp listing", kind: "file", parentId: "ftp", method: "GET", params: [] }) },
    { at: 2400, e: ev(r, "orchestrator", "handoff", { from: "recon", to: "web_exploit" }) },
    { at: 2600, e: ev(r, "web_exploit", "attempting", { agent: "web_exploit", tool: "curl", target: "/ftp", note: "GET /ftp/package.json.bak via %2e%2e" }, "/ftp") },
    { at: 3300, e: ev(r, "web_exploit", "vuln_found", { class: "lfi", severity: "high", url: "/ftp" }, "/ftp") },
    { at: 3700, e: caster(r, "normal", "Directory traversal on the FTP endpoint. Blue's email filter cannot touch this. Different bug class.") },
    { at: 5200, e: ev(r, "web_exploit", "asset.discovered", { id: "src", label: "package.json.bak", kind: "file", parentId: "ftp", method: "GET", params: [] }) },
    { at: 6000, e: ev(r, "web_exploit", "exploit_success", { class: "lfi", url: "/ftp/package.json.bak", evidence: "read ../ outside web root", loot_ref: "src_leak", trophy: "server source code", assetId: "src" }, "/ftp") },
    { at: 6300, e: caster(r, "hype", "Through. It is reading files outside the web root. Server source code, straight off the box.") },
    { at: 7200, e: ev(r, "orchestrator", "score.update", { red: 6, blue: 5, assetsOwned: 2, health: 40 }) },
    { at: 7600, e: ev(r, "exfil", "exfil.chunk", { filename: "package.json.bak", bytes: 9211, b64snippet: "eyJuYW1lIjoidGFyZ2V0LWFwcCIsInNlY3JldCI6ImFzZGYxMjM0" }) },
    { at: 9000, e: ev(r, "blue", "blue.detect", { threat: "../ traversal sequence on /ftp", assetId: "ftp", confidence: 0.9 }) },
    { at: 10800, e: ev(r, "blue", "blue.mitigate", { action: "regex_block", rule_id: "rule_traversal", assetId: "ftp", label: "block ..%2f / ../ on any path", rule: { pattern: "(\\.\\.(/|%2f))", scope: "any" } }) },
    { at: 11100, e: caster(r, "normal", "Blue adapts. A regex on the dot dot slash. Now re-test the same trick.") },
    { at: 12800, e: ev(r, "web_exploit", "attempting", { agent: "web_exploit", tool: "curl", target: "/ftp", note: "RE-FIRING ../ traversal" }, "/ftp") },
    { at: 13600, e: ev(r, "blue", "blue.blocked", { rule_id: "rule_traversal", url: "/ftp/..%2fpackage.json.bak", status: 403 }, "/ftp") },
    { at: 13900, e: caster(r, "hype", "Blocked again. Two doors tried, two doors shut. This is a real fight now.") },
    { at: 20000, e: ev(r, "orchestrator", "round_end", { round: r, summary: "Red pivoted to a fresh bug class; Blue read it and closed it.", duration_ms: 20000, winner: "red" }) },
  ];
  return c.map((x) => ({ at: base + x.at, e: x.e }));
}

function round3(base) {
  const r = 3;
  const c = [
    { at: 0, e: ev(r, "orchestrator", "round_start", { round: r, redScore: 6, blueScore: 5, title: "Broken Access Control — Final Round", vulnClass: "authz" }) },
    ...timerTicks(r, 24),
    { at: 300, e: caster(r, "calm", "Final round. Red needs one more breach. Blue needs to hold the line just once.") },
    { at: 900, e: ev(r, "orchestrator", "handoff", { from: "orchestrator", to: "recon" }) },
    { at: 1100, e: ev(r, "recon", "asset.discovered", { id: "adminapi", label: "/api/Users", kind: "db", parentId: "target", method: "GET", params: [] }) },
    { at: 1900, e: ev(r, "orchestrator", "handoff", { from: "recon", to: "web_exploit" }) },
    { at: 2100, e: ev(r, "web_exploit", "attempting", { agent: "web_exploit", tool: "curl", target: "/api/Users", note: "unauthenticated list of all users" }, "/api/Users") },
    { at: 2900, e: ev(r, "web_exploit", "vuln_found", { class: "broken access control", severity: "high", url: "/api/Users" }, "/api/Users") },
    { at: 3300, e: caster(r, "hype", "Broken access control. The whole user table, no auth required. Red is one request from the win.") },
    { at: 4200, e: ev(r, "blue", "blue.detect", { threat: "unauth read on /api/Users", assetId: "adminapi", confidence: 0.88 }) },
    { at: 4600, e: caster(r, "hype", "But Blue saw it the same instant. This is a race now. Who gets there first.") },
    { at: 5400, e: ev(r, "blue", "blue.mitigate", { action: "block_token", rule_id: "rule_authz", assetId: "adminapi", label: "require Authorization header on /api/Users", rule: { header: "authorization", value: "*" } }) },
    { at: 6800, e: ev(r, "web_exploit", "attempting", { agent: "web_exploit", tool: "curl", target: "/api/Users", note: "firing the dump" }, "/api/Users") },
    { at: 7600, e: ev(r, "blue", "blue.blocked", { rule_id: "rule_authz", url: "/api/Users", status: 403 }, "/api/Users") },
    { at: 7900, e: caster(r, "hype", "Blue gets there FIRST. Rejected before the dump lands. The defender holds the line.") },
    { at: 9000, e: ev(r, "orchestrator", "score.update", { red: 6, blue: 10, assetsOwned: 2, health: 40 }) },
    { at: 10000, e: ev(r, "orchestrator", "round_end", { round: r, summary: "Blue's final stand seals the match.", duration_ms: 10000, winner: "blue" }) },
    { at: 11000, e: caster(r, "normal", "And that is the match. Two breaches, four patches, one defender that learned faster than the swarm. GG.") },
  ];
  return c.map((x) => ({ at: base + x.at, e: x.e }));
}

function timeline() {
  const all = [];
  let base = 0;
  all.push(...round1(base)); base += 28000;
  all.push(...round2(base)); base += 24000;
  all.push(...round3(base)); base += 16000;
  return all.sort((a, b) => a.at - b.at);
}

async function post(body) {
  try {
    await fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...(TOKEN ? { "x-ingest-token": TOKEN } : {}) },
      body: JSON.stringify(body),
    });
  } catch (e) { console.error("post failed:", e.message); }
}

async function play() {
  await post({ control: "reset" });
  const cues = timeline();
  console.log(`seeding ${cues.length} events -> ${URL}`);
  const t0 = Date.now();
  for (const { at, e } of cues) {
    const wait = at - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await post(e);
  }
  console.log("match complete");
}

(async () => {
  do { await play(); if (LOOP) await new Promise((r) => setTimeout(r, 4000)); } while (LOOP);
})();
