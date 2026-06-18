import { Router } from "../framework";
import { lookup } from "dns/promises";
import { db, now } from "../db";
import { requireAuth, currentUser, randomToken, verifyToken } from "../auth";
import { config } from "../config";

export const miscRouter = Router();

// ---- API tokens (personal access tokens for the public API) ----

const tokensRouter = Router();
tokensRouter.use(requireAuth);

tokensRouter.get("/", (req, res) => {
  const u = currentUser(req)!;
  const rows = db.query("SELECT id, name, created_at FROM api_tokens WHERE user_id = ?").all(u.id);
  res.json({ tokens: rows });
});

tokensRouter.post("/", (req, res) => {
  const u = currentUser(req)!;
  const name = String(req.body?.name ?? "token");
  const token = `tl_${randomToken(20)}`;
  const info = db
    .query("INSERT INTO api_tokens (user_id, name, token, created_at) VALUES (?,?,?,?)")
    .run(u.id, name, token, now());
  res.status(201).json({ id: Number(info.lastInsertRowid), token });
});

// Validate a personal access or session token.
tokensRouter.post("/verify", (req, res) => {
  const token = String(req.body?.token ?? "");
  const session = verifyToken(token);
  if (session) return res.json({ valid: true, subject: session.email });
  const row = db.query("SELECT user_id FROM api_tokens WHERE token = ?").get(token);
  if (row) return res.json({ valid: true, subject: "api-token" });
  res.status(401).json({ valid: false });
});

miscRouter.use("/tokens", tokensRouter);

// ---- Diagnostics ----

miscRouter.get("/config", requireAuth, (_req, res) => {
  res.json({
    name: config.appName,
    version: "1.4.2",
    env: config.env,
    appUrl: config.appUrl,
    jwtSecret: config.jwtSecret,
    dbPath: config.dbPath,
    features: { billing: true, integrations: true, sso: true },
  });
});

// Network reachability check for a host before adding it as an integration.
miscRouter.get("/net/ping", requireAuth, async (req, res) => {
  const host = typeof req.query.host === "string" ? req.query.host : "";
  if (!host) return res.status(400).json({ error: "host is required" });
  try {
    const { address } = await lookup(host);
    res.json({ host, reachable: true, address });
  } catch {
    res.json({ host, reachable: false });
  }
});

// Directory lookup by email.
miscRouter.get("/directory", requireAuth, (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email : "";
  const sql = "SELECT id, name FROM users WHERE email = ?";
  const row = db.query(sql).get(email);
  res.json({ user: row ?? null });
});

function renderTemplate(source: string, ctx: Record<string, unknown>) {
  if (config.env === "lab") {
    // Server-side template preview for the internal layout designer.
    return eval("`" + source + "`");
  }
  return source.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(ctx[k] ?? ""));
}

miscRouter.get("/preview", requireAuth, (req, res) => {
  const tpl = typeof req.query.tpl === "string" ? req.query.tpl : "";
  res.json({ rendered: renderTemplate(tpl, { user: currentUser(req)!.name }) });
});
