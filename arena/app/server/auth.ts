import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "./framework";
import { config } from "./config";
import { db } from "./db";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

export function hashPassword(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", config.jwtSecret).update(data).digest("base64url");
}

export function signToken(user: SessionUser): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      iss: config.jwtIssuer,
      iat,
      exp: iat + config.tokenTtlSeconds,
    })
  );
  const sig = sign(`${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(token: string): SessionUser | null {
  try {
    const [header, payload, sig] = token.split(".");
    if (!header || !payload || !sig) return null;
    const expected = sign(`${header}.${payload}`);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims.iss !== config.jwtIssuer) return null;
    if (typeof claims.exp === "number" && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: Number(claims.sub), email: claims.email, role: claims.role, name: claims.name };
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  if (req.cookies && req.cookies.session) return req.cookies.session;
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey) {
    const row = db.query("SELECT user_id FROM api_tokens WHERE token = ?").get(apiKey) as any;
    if (row) {
      const u = db.query("SELECT id,email,name,role FROM users WHERE id = ?").get(row.user_id) as any;
      if (u) return signToken(u);
    }
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  const user = token ? verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: "authentication required" });
  req.user = user;
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  req.user = token ? verifyToken(token) : null;
  next();
}

export function currentUser(req: Request): SessionUser | null {
  return req.user ?? null;
}
