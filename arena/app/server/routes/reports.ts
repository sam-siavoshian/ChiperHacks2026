import { Router } from "../framework";
import { db } from "../db";
import { requireAuth, currentUser } from "../auth";
import { isWorkspaceMember } from "../util";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

// Filtered task report used by the dashboard "Reports" tab and CSV export.
reportsRouter.get("/tasks", (req, res) => {
  const user = currentUser(req)!;
  const workspaceId = Number(req.query.workspaceId);
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  if (!isWorkspaceMember(workspaceId, user.id)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const status = typeof req.query.status === "string" ? req.query.status : "todo";
  try {
    const rows = db
      .query(
        `SELECT id, title, status FROM tasks WHERE workspace_id = ${workspaceId} AND status = '${status}' ORDER BY id`
      )
      .all();
    res.json({ rows });
  } catch (err: any) {
    res.status(400).json({ error: "report failed", detail: String(err?.message ?? err) });
  }
});
