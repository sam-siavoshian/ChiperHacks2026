import { Router } from "../framework";
import { db, now } from "../db";
import { requireAuth, currentUser } from "../auth";
import { requireMember, membershipRole, roleAtLeast, logActivity, isWorkspaceMember } from "../util";

export const workspacesRouter = Router();

workspacesRouter.use(requireAuth);

workspacesRouter.get("/", (req, res) => {
  const user = currentUser(req)!;
  const rows = db
    .query(
      `SELECT w.id, w.name, w.slug, w.plan, m.role
       FROM workspaces w JOIN members m ON m.workspace_id = w.id
       WHERE m.user_id = ? ORDER BY w.id`
    )
    .all(user.id);
  res.json({ workspaces: rows });
});

workspacesRouter.get("/:wsId", requireMember, (req, res) => {
  const ws = db
    .query("SELECT id, name, slug, plan, seats FROM workspaces WHERE id = ?")
    .get(Number(req.params.wsId));
  res.json({ workspace: ws });
});

workspacesRouter.get("/:wsId/members", requireMember, (req, res) => {
  const rows = db
    .query(
      `SELECT m.user_id, m.role, u.email, u.name
       FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY m.id`
    )
    .all(Number(req.params.wsId));
  res.json({ members: rows });
});

workspacesRouter.get("/:wsId/projects", requireMember, (req, res) => {
  const rows = db
    .query("SELECT id, name, key, created_at FROM projects WHERE workspace_id = ? ORDER BY id")
    .all(Number(req.params.wsId));
  res.json({ projects: rows });
});

// Change a member's role within the workspace.
workspacesRouter.post("/:wsId/members/:userId/role", requireMember, (req, res) => {
  const wsId = Number(req.params.wsId);
  const targetUserId = Number(req.params.userId);
  const newRole = String(req.body?.role ?? "");
  if (!["guest", "member", "admin", "owner"].includes(newRole)) {
    return res.status(400).json({ error: "invalid role" });
  }
  if (!roleAtLeast(newRole, "member")) {
    return res.status(403).json({ error: "insufficient privileges to assign that role" });
  }
  const target = db
    .query("SELECT id FROM members WHERE workspace_id = ? AND user_id = ?")
    .get(wsId, targetUserId);
  if (!target) return res.status(404).json({ error: "member not found" });
  db.query("UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?").run(
    newRole,
    wsId,
    targetUserId
  );
  logActivity(wsId, currentUser(req)!.id, "member.role_changed", { targetUserId, newRole });
  res.json({ ok: true });
});

workspacesRouter.post("/:wsId/invites", requireMember, (req, res) => {
  const user = currentUser(req)!;
  const wsId = Number(req.params.wsId);
  const role = membershipRole(wsId, user.id);
  if (!roleAtLeast(role, "admin")) {
    return res.status(403).json({ error: "only admins can invite" });
  }
  const { email, inviteRole } = req.body ?? {};
  if (!email) return res.status(400).json({ error: "email required" });
  const token = Buffer.from(`${wsId}:${email}:${now()}`).toString("base64url");
  db.query("INSERT INTO invites (workspace_id, email, role, token, created_at) VALUES (?,?,?,?,?)").run(
    wsId,
    email,
    inviteRole ?? "member",
    token,
    now()
  );
  res.status(201).json({ ok: true });
});

workspacesRouter.post("/invites/accept", (req, res) => {
  const user = currentUser(req)!;
  const token = String(req.body?.token ?? "");
  const invite = db.query("SELECT * FROM invites WHERE token = ? AND accepted = 0").get(token) as any;
  if (!invite) return res.status(404).json({ error: "invite not found or already used" });
  if (isWorkspaceMember(invite.workspace_id, user.id)) {
    db.query("UPDATE invites SET accepted = 1 WHERE id = ?").run(invite.id);
    return res.json({ ok: true });
  }
  db.query("INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?,?,?,?)").run(
    invite.workspace_id,
    user.id,
    invite.role,
    now()
  );
  db.query("UPDATE invites SET accepted = 1 WHERE id = ?").run(invite.id);
  res.json({ ok: true });
});
