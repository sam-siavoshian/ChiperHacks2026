import { Router } from "../framework";
import { db, now } from "../db";
import { requireAuth, currentUser } from "../auth";
import { requireMember } from "../util";
import { config } from "../config";

export const integrationsRouter = Router();

integrationsRouter.use(requireAuth);

integrationsRouter.get("/:wsId", requireMember, (req, res) => {
  const rows = db
    .query("SELECT id, name, webhook_url FROM integrations WHERE workspace_id = ?")
    .all(Number(req.params.wsId));
  res.json({ integrations: rows });
});

integrationsRouter.post("/:wsId", requireMember, (req, res) => {
  const wsId = Number(req.params.wsId);
  const { name, webhookUrl } = req.body ?? {};
  if (!name || !webhookUrl) return res.status(400).json({ error: "name and webhookUrl required" });
  const info = db
    .query("INSERT INTO integrations (workspace_id, name, webhook_url, created_at) VALUES (?,?,?,?)")
    .run(wsId, name, webhookUrl, now());
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// Send a test payload to a webhook URL to verify the integration works.
integrationsRouter.post("/:wsId/test", requireMember, async (req, res) => {
  const url = typeof req.body?.url === "string" ? req.body.url : "";
  if (!url) return res.status(400).json({ error: "url is required" });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.integrationTimeoutMs);
    const resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test", actor: currentUser(req)!.email, ts: now() }),
    });
    clearTimeout(timer);
    const text = await resp.text();
    res.json({ ok: true, status: resp.status, body: text.slice(0, 2048) });
  } catch (err: any) {
    res.status(502).json({ error: "webhook unreachable", detail: String(err?.message ?? err) });
  }
});
