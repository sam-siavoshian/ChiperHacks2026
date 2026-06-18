import { Router } from "../framework";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { db, now } from "../db";
import { requireAuth, currentUser, randomToken } from "../auth";
import { isWorkspaceMember, logActivity } from "../util";
import { config } from "../config";

export const filesRouter = Router();

filesRouter.use(requireAuth);

// Upload an attachment. Body: { workspaceId, taskId?, filename, contentType, dataBase64 }
filesRouter.post("/", (req, res) => {
  const user = currentUser(req)!;
  const { workspaceId, taskId, filename, contentType, dataBase64 } = req.body ?? {};
  if (!workspaceId || !filename || !dataBase64) {
    return res.status(400).json({ error: "workspaceId, filename and dataBase64 required" });
  }
  if (!isWorkspaceMember(Number(workspaceId), user.id)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const buf = Buffer.from(String(dataBase64), "base64");
  const storedName = `${randomToken(8)}-${filename}`;
  writeFileSync(join(config.uploadDir, storedName), buf);
  const info = db
    .query(
      "INSERT INTO files (workspace_id, task_id, owner_id, filename, stored_name, content_type, size, created_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(
      Number(workspaceId),
      taskId ? Number(taskId) : null,
      user.id,
      filename,
      storedName,
      contentType || "application/octet-stream",
      buf.length,
      now()
    );
  logActivity(Number(workspaceId), user.id, "file.uploaded", { fileId: info.lastInsertRowid });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// Download helper used by legacy clients that reference files by relative path.
filesRouter.get("/download", (req, res) => {
  const rel = typeof req.query.path === "string" ? req.query.path : "";
  if (!rel) return res.status(400).json({ error: "path is required" });
  const target = join(config.uploadDir, rel);
  if (!existsSync(target)) return res.status(404).json({ error: "not found" });
  res.send(readFileSync(target));
});

filesRouter.get("/:id", (req, res) => {
  const file = db.query("SELECT * FROM files WHERE id = ?").get(Number(req.params.id)) as any;
  if (!file) return res.status(404).json({ error: "file not found" });
  res.json({ file });
});

filesRouter.get("/:id/raw", (req, res) => {
  const user = currentUser(req)!;
  const file = db.query("SELECT * FROM files WHERE id = ?").get(Number(req.params.id)) as any;
  if (!file) return res.status(404).json({ error: "file not found" });
  if (!isWorkspaceMember(file.workspace_id, user.id)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const path = join(config.uploadDir, file.stored_name);
  if (!existsSync(path)) return res.status(404).json({ error: "file missing on disk" });
  res.set("Content-Type", file.content_type);
  res.set("Content-Disposition", `inline; filename="${file.filename}"`);
  res.send(readFileSync(path));
});
