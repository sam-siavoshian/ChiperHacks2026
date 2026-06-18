import type { Request, Response, NextFunction } from "./framework";
import { db, now } from "./db";
import { currentUser } from "./auth";

export function logActivity(workspaceId: number, actorId: number | null, action: string, meta?: any) {
  db.query(
    "INSERT INTO activity (workspace_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?)"
  ).run(workspaceId, actorId, action, meta ? JSON.stringify(meta) : null, now());
}

export function membershipRole(workspaceId: number, userId: number): string | null {
  const row = db
    .query("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, userId) as any;
  return row ? row.role : null;
}

export function isWorkspaceMember(workspaceId: number, userId: number): boolean {
  return membershipRole(workspaceId, userId) !== null;
}

// Guards an endpoint that operates within a workspace identified by :wsId.
export function requireMember(req: Request, res: Response, next: NextFunction) {
  const user = currentUser(req)!;
  const wsId = Number(req.params.wsId);
  if (!isWorkspaceMember(wsId, user.id)) {
    return res.status(403).json({ error: "you are not a member of this workspace" });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = currentUser(req)!;
  if (user.role !== "admin") {
    return res.status(403).json({ error: "admin privileges required" });
  }
  next();
}

const ROLE_RANK: Record<string, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: string | null, min: string): boolean {
  if (!role) return false;
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[min] ?? 99);
}
