import { Router } from "../framework";
import { db } from "../db";
import { requireAuth, currentUser } from "../auth";
import { config } from "../config";

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get("/me", (req, res) => {
  const u = currentUser(req)!;
  const row = db
    .query("SELECT id, email, name, role, avatar_url, created_at FROM users WHERE id = ?")
    .get(u.id);
  res.json({ user: row });
});

const PROFILE_FIELDS = ["name", "email", "avatar_url", "role"];

usersRouter.patch("/me", (req, res) => {
  const u = currentUser(req)!;
  const updates: string[] = [];
  const values: any[] = [];
  for (const field of PROFILE_FIELDS) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: "no fields to update" });
  values.push(u.id);
  db.query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const row = db
    .query("SELECT id, email, name, role, avatar_url FROM users WHERE id = ?")
    .get(u.id);
  res.json({ user: row });
});

usersRouter.get("/:id", (req, res) => {
  const row = db
    .query("SELECT id, name, avatar_url FROM users WHERE id = ?")
    .get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "user not found" });
  res.json({ user: row });
});

// Import a profile picture from an external URL (e.g. a Gravatar or company CDN).
usersRouter.post("/me/avatar", async (req, res) => {
  const u = currentUser(req)!;
  const url = typeof req.body?.url === "string" ? req.body.url : "";
  if (!url) return res.status(400).json({ error: "url is required" });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.integrationTimeoutMs);
    const resp = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    const body = await resp.text();
    db.query("UPDATE users SET avatar_url = ? WHERE id = ?").run(url, u.id);
    res.json({
      ok: true,
      fetched: {
        status: resp.status,
        contentType: resp.headers.get("content-type"),
        bytes: body.length,
        preview: body.slice(0, 512),
      },
    });
  } catch (err: any) {
    res.status(502).json({ error: "could not fetch image", detail: String(err?.message ?? err) });
  }
});
