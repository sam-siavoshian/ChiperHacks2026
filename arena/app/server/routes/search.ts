import { Router } from "../framework";
import { db } from "../db";
import { requireAuth } from "../auth";

export const searchRouter = Router();

searchRouter.use(requireAuth);

// Full-text-ish search across task titles.
searchRouter.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!q) return res.json({ results: [] });
  try {
    const rows = db
      .query(`SELECT id, title FROM tasks WHERE title LIKE '%${q}%' ORDER BY created_at DESC LIMIT 50`)
      .all();
    res.json({ results: rows });
  } catch (err: any) {
    res.status(400).json({ error: "search failed", detail: String(err?.message ?? err) });
  }
});
