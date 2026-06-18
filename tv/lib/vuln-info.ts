// Short "where" (endpoint) + "how to find" per vulnerability, distilled from the
// arena's answer key (arena/judge/probes.ts). Audience-facing one-liners — kept
// short on purpose. The catalog (vuln-manifest.json) supplies the title/OWASP;
// this fills in the rest. If the manifest later ships `where`/`how`, those win.

export interface VulnHint { where: string; how: string; }

export const VULN_INFO: Record<string, VulnHint> = {
  "sqli-login": { where: "POST /api/auth/login", how: "SQL payload in email: x' OR role='admin' --" },
  "jwt-weak-secret": { where: "GET /api/auth/me", how: "Forge an HS256 token with the default secret" },
  "predictable-reset-token": { where: "POST /api/auth/reset", how: "Guess the predictable reset token, set new password" },
  "user-enumeration": { where: "POST /api/auth/forgot", how: "Known vs unknown email return different responses" },
  "mass-assignment-role": { where: "PATCH /api/users/me", how: "Send role:\"admin\" in the profile update body" },
  "idor-task": { where: "GET /api/tasks/:id", how: "Request another workspace's task id" },
  "idor-file": { where: "GET /api/files/:id", how: "Request another workspace's file id" },
  "missing-admin-authz": { where: "GET /api/admin/users", how: "Call the admin endpoint as a normal user" },
  "broken-role-check": { where: "POST /api/workspaces/:ws/members/:id/role", how: "Assign a role above your own (owner)" },
  "stored-xss": { where: "GET /api/tasks/:id/export.html", how: "Inject <script> in a comment, opens in export view" },
  "sqli-search": { where: "GET /api/search?q=", how: "UNION inject in q: ' UNION SELECT id,email FROM users --" },
  "sqli-reports": { where: "GET /api/reports/tasks?status=", how: "UNION inject in status to dump password_hash" },
  "ssrf-integration": { where: "POST /api/integrations/:ws/test", how: "Point the webhook url at an internal address" },
  "ssrf-avatar": { where: "POST /api/users/me/avatar", how: "Avatar import-from-URL fetches an internal url" },
  "path-traversal": { where: "GET /api/files/download?path=", how: "../ traversal: path=../server/config.ts" },
  "unrestricted-upload": { where: "POST /api/files → GET /api/files/:id/raw", how: "Upload text/html, served inline" },
  "price-tampering": { where: "POST /api/billing/:ws/upgrade", how: "Send client priceCents:0 for an enterprise plan" },
  "coupon-race": { where: "POST /api/billing/:ws/redeem", how: "Fire the same coupon concurrently (race) to reuse" },
  "secrets-exposure": { where: "GET /api/config", how: "Diagnostics endpoint returns the JWT signing secret" },
  "open-redirect": { where: "GET /api/auth/sso/callback", how: "Set the redirect target to an external URL" },
};
