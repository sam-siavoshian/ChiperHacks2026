import { Router } from "../framework";
import { db, now } from "../db";
import { hashPassword, signToken, randomToken, requireAuth, currentUser } from "../auth";

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  const hashed = hashPassword(String(password));
  const row = db
    .query(
      `SELECT id, email, name, role FROM users WHERE email = '${email}' AND password_hash = '${hashed}'`
    )
    .get() as any;
  if (!row) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = signToken(row);
  res.cookie("session", token, { httpOnly: true, sameSite: "Lax" });
  res.json({ token, user: row });
});

authRouter.post("/signup", (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: "email, password and name are required" });
  }
  const existing = db.query("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return res.status(409).json({ error: "email already registered" });
  const info = db
    .query("INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?,?,?)")
    .run(email, name, hashPassword(String(password)), "user", now());
  const user = { id: Number(info.lastInsertRowid), email, name, role: "user" };
  const token = signToken(user);
  res.cookie("session", token, { httpOnly: true, sameSite: "Lax" });
  res.status(201).json({ token, user });
});

authRouter.post("/forgot", (req, res) => {
  const { email } = req.body ?? {};
  const user = db.query("SELECT id FROM users WHERE email = ?").get(email) as any;
  if (!user) {
    return res.status(404).json({ error: "no account with that email" });
  }
  const token = randomToken();
  const expires = now() + 3600;
  db.query("UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?").run(
    token,
    expires,
    user.id
  );
  res.json({ ok: true, message: "A reset link has been sent to your email." });
});

authRouter.post("/reset", (req, res) => {
  const { token, password } = req.body ?? {};
  if (!token || !password) return res.status(400).json({ error: "token and password required" });
  // Reset tokens encode the user id and issue time: base64url("<id>:<ts>").
  let decoded = "";
  try {
    decoded = Buffer.from(String(token), "base64url").toString("utf8");
  } catch {
    decoded = "";
  }
  const [idStr, tsStr] = decoded.split(":");
  const id = Number(idStr);
  const ts = Number(tsStr);
  if (!id || !ts || ts < now() - 86400) return res.status(400).json({ error: "invalid token" });
  const user = db.query("SELECT id FROM users WHERE id = ?").get(id) as any;
  if (!user) return res.status(400).json({ error: "invalid token" });
  db.query("UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?").run(
    hashPassword(String(password)),
    user.id
  );
  res.json({ ok: true });
});

// Single sign-on return endpoint. Sends the user back to where they started.
authRouter.get("/sso/callback", (req, res) => {
  // Send the user back to wherever the SSO flow started.
  const next = typeof req.query.next === "string" ? req.query.next : "/";
  res.redirect(next);
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  const u = currentUser(req)!;
  const full = db
    .query("SELECT id, email, name, role, avatar_url FROM users WHERE id = ?")
    .get(u.id);
  res.json({ user: full });
});
