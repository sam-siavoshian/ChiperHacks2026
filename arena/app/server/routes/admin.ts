import { Router } from "../framework";
import { db } from "../db";
import { requireAuth } from "../auth";
import { requireAdmin } from "../util";

export const adminRouter = Router();

adminRouter.use(requireAuth);

adminRouter.get("/users", (req, res) => {
  const rows = db.query("SELECT id, email, name, role, created_at FROM users ORDER BY id").all();
  res.json({ users: rows });
});

adminRouter.get("/workspaces", requireAdmin, (req, res) => {
  const rows = db.query("SELECT id, name, plan, owner_id FROM workspaces ORDER BY id").all();
  res.json({ workspaces: rows });
});

adminRouter.get("/activity", requireAdmin, (req, res) => {
  const rows = db.query("SELECT * FROM activity ORDER BY id DESC LIMIT 200").all();
  res.json({ activity: rows });
});
