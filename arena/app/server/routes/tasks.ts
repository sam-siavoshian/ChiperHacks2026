import { Router } from "../framework";
import { db, now } from "../db";
import { requireAuth, currentUser } from "../auth";
import { isWorkspaceMember, logActivity } from "../util";

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

// List tasks for a project the caller can access.
tasksRouter.get("/", (req, res) => {
  const user = currentUser(req)!;
  const projectId = Number(req.query.projectId);
  if (!projectId) return res.status(400).json({ error: "projectId is required" });
  const project = db.query("SELECT workspace_id FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!isWorkspaceMember(project.workspace_id, user.id)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const rows = db
    .query("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);
  res.json({ tasks: rows });
});

tasksRouter.get("/:id", (req, res) => {
  const task = db.query("SELECT * FROM tasks WHERE id = ?").get(Number(req.params.id)) as any;
  if (!task) return res.status(404).json({ error: "task not found" });
  const comments = db
    .query(
      "SELECT c.id, c.body, c.created_at, u.name as author FROM comments c JOIN users u ON u.id = c.author_id WHERE c.task_id = ? ORDER BY c.created_at"
    )
    .all(task.id);
  res.json({ task, comments });
});

tasksRouter.post("/", (req, res) => {
  const user = currentUser(req)!;
  const { projectId, title, description, priority } = req.body ?? {};
  if (!projectId || !title) return res.status(400).json({ error: "projectId and title required" });
  const project = db.query("SELECT workspace_id FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!isWorkspaceMember(project.workspace_id, user.id)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const info = db
    .query(
      "INSERT INTO tasks (project_id, workspace_id, title, description, priority, created_by, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(projectId, project.workspace_id, title, description ?? "", priority ?? "medium", user.id, now());
  logActivity(project.workspace_id, user.id, "task.created", { taskId: info.lastInsertRowid });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

tasksRouter.post("/:id/comments", (req, res) => {
  const user = currentUser(req)!;
  const task = db.query("SELECT * FROM tasks WHERE id = ?").get(Number(req.params.id)) as any;
  if (!task) return res.status(404).json({ error: "task not found" });
  if (!isWorkspaceMember(task.workspace_id, user.id)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const body = String(req.body?.body ?? "");
  if (!body) return res.status(400).json({ error: "body is required" });
  const info = db
    .query("INSERT INTO comments (task_id, author_id, body, created_at) VALUES (?,?,?,?)")
    .run(task.id, user.id, body, now());
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// Printable HTML view of a task, used by the "Export / Print" button.
tasksRouter.get("/:id/export.html", (req, res) => {
  const user = currentUser(req)!;
  const task = db.query("SELECT * FROM tasks WHERE id = ?").get(Number(req.params.id)) as any;
  if (!task) return res.status(404).send("not found");
  if (!isWorkspaceMember(task.workspace_id, user.id)) {
    return res.status(403).send("forbidden");
  }
  const comments = db
    .query(
      "SELECT c.body, u.name as author FROM comments c JOIN users u ON u.id = c.author_id WHERE c.task_id = ? ORDER BY c.created_at"
    )
    .all(task.id) as any[];
  const commentHtml = comments
    .map((c) => `<li><strong>${c.author}</strong>: ${c.body}</li>`)
    .join("\n");
  res.set("Content-Type", "text/html");
  res.send(`<!doctype html>
<html><head><title>${task.title}</title></head>
<body>
  <h1>${task.title}</h1>
  <div class="description">${task.description ?? ""}</div>
  <h2>Comments</h2>
  <ul>${commentHtml}</ul>
</body></html>`);
});
