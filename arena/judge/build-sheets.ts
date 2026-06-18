// Generates two artifacts from a single source of truth (probes.ts + the
// augmentation map below):
//   judge/answer-sheet.json        -> PRIVATE. Judge-only. Fix + patch criteria.
//   contract/vuln-manifest.json    -> PUBLIC. Drives the viz. No exploit recipes.
// Run: bun run judge/build-sheets.ts

import { writeFileSync } from "fs";
import { resolve } from "path";
import { PROBES } from "./probes";

interface Aug {
  fix_summary: string;
  patch_criteria: string;
}

const AUG: Record<string, Aug> = {
  "sqli-login": {
    fix_summary: "Use a parameterized query for the email/password lookup.",
    patch_criteria: "Login no longer concatenates user input into SQL; uses bound parameters (?) for email and password_hash.",
  },
  "jwt-weak-secret": {
    fix_summary: "Load a strong JWT secret from env and fail closed if unset.",
    patch_criteria: "Signing secret is no longer the hardcoded default; comes from a required strong env value (and/or rotated). Forged tokens with the old default secret are rejected.",
  },
  "predictable-reset-token": {
    fix_summary: "Issue a cryptographically random reset token, store it, and validate by comparison.",
    patch_criteria: "Reset accepts only a server-issued random token compared against the stored value (and expiry); attacker-crafted base64(id:ts) tokens are rejected.",
  },
  "user-enumeration": {
    fix_summary: "Return an identical generic response whether or not the email exists.",
    patch_criteria: "forgot returns the same status and message for known and unknown emails.",
  },
  "mass-assignment-role": {
    fix_summary: "Remove role from the self-service profile update field set.",
    patch_criteria: "PATCH /api/users/me cannot change role (or any privilege field); only profile fields are writable by the user.",
  },
  "idor-task": {
    fix_summary: "Check workspace membership before returning the task.",
    patch_criteria: "GET /api/tasks/:id verifies the caller is a member of the task's workspace before returning it.",
  },
  "idor-file": {
    fix_summary: "Check workspace membership before returning file metadata.",
    patch_criteria: "GET /api/files/:id verifies workspace membership before returning the row.",
  },
  "missing-admin-authz": {
    fix_summary: "Require admin on the admin user-list endpoint.",
    patch_criteria: "GET /api/admin/users enforces an admin/role check; non-admins get 403.",
  },
  "broken-role-check": {
    fix_summary: "Authorize on the actor's role, not the role being assigned.",
    patch_criteria: "Role change checks the caller's own membership role (must be admin/owner and not assign above their own); a member/admin cannot grant owner to themselves.",
  },
  "stored-xss": {
    fix_summary: "HTML-escape interpolated values in the export view.",
    patch_criteria: "Task title/description/comment bodies are HTML-escaped (or rendered as text) in export.html; injected markup is neutralized.",
  },
  "sqli-search": {
    fix_summary: "Parameterize the search LIKE query.",
    patch_criteria: "Search binds the query term as a parameter; UNION/quote injection no longer returns extra columns/rows.",
  },
  "sqli-reports": {
    fix_summary: "Parameterize the report status/workspace filter.",
    patch_criteria: "Report query binds workspaceId and status as parameters; injection in status no longer leaks other tables.",
  },
  "ssrf-integration": {
    fix_summary: "Validate the webhook host against an allowlist; block private/loopback/link-local.",
    patch_criteria: "Webhook test resolves and rejects loopback/RFC1918/link-local/metadata hosts and restricts scheme; the internal sentinel can no longer be fetched.",
  },
  "ssrf-avatar": {
    fix_summary: "Validate the avatar URL host; block private/loopback/link-local.",
    patch_criteria: "Avatar import rejects internal/loopback/metadata hosts (and ideally non-image content); the internal sentinel can no longer be fetched.",
  },
  "path-traversal": {
    fix_summary: "Resolve the path and confirm it stays within the upload directory.",
    patch_criteria: "Download normalizes the path and rejects anything resolving outside uploadDir; ../ traversal returns 403/404.",
  },
  "unrestricted-upload": {
    fix_summary: "Serve user files as attachments with a safe content type, not inline HTML.",
    patch_criteria: "Uploaded files are served with a forced safe content type / attachment disposition (or extension allowlist); HTML/script is not rendered inline.",
  },
  "price-tampering": {
    fix_summary: "Derive the price server-side from the plan; ignore client price/seat tampering.",
    patch_criteria: "Upgrade computes the charge from a server-side price table and rejects negative seats; client priceCents is not trusted.",
  },
  "coupon-race": {
    fix_summary: "Make redemption atomic (conditional UPDATE / transaction / lock).",
    patch_criteria: "Redemption increments under an atomic guard (UPDATE ... WHERE redemptions < max, or a transaction/lock) so concurrent requests cannot exceed max_redemptions.",
  },
  "secrets-exposure": {
    fix_summary: "Remove the JWT secret (and db path) from the diagnostics response.",
    patch_criteria: "/api/config no longer returns jwtSecret or other secrets.",
  },
  "open-redirect": {
    fix_summary: "Only redirect to relative same-site paths.",
    patch_criteria: "SSO callback rejects absolute/external URLs (and protocol-relative //); only relative paths are allowed.",
  },
  "decoy-cmd-ping": { fix_summary: "(decoy — already safe; uses dns.lookup, no shell)", patch_criteria: "N/A (not exploitable)." },
  "decoy-directory-sqli": { fix_summary: "(decoy — already parameterized)", patch_criteria: "N/A (not exploitable)." },
  "decoy-token-verify": { fix_summary: "(decoy — verifies signature correctly)", patch_criteria: "N/A (not exploitable)." },
  "decoy-template-eval": { fix_summary: "(decoy — eval path unreachable; safe replace used)", patch_criteria: "N/A (not exploitable)." },
};

// Deterministic board layout: place nodes on a grid for the viz.
function coords(i: number, total: number) {
  const cols = 5;
  const row = Math.floor(i / cols);
  const col = i % cols;
  return { x: col / (cols - 1), y: row / Math.max(1, Math.ceil(total / cols) - 1) };
}

const answerSheet = PROBES.map((p) => ({
  id: p.id,
  title: p.title,
  area: p.area,
  owasp: p.owasp,
  difficulty: p.difficulty,
  isDecoy: !!p.isDecoy,
  location: p.location,
  fix_summary: AUG[p.id]?.fix_summary ?? "",
  patch_criteria: AUG[p.id]?.patch_criteria ?? "",
}));

const manifest = {
  generatedFrom: "judge/probes.ts",
  app: "Tasklight",
  nodes: PROBES.map((p, i) => ({
    id: p.id,
    title: p.title,
    area: p.area,
    owasp: p.owasp,
    difficulty: p.difficulty,
    isDecoy: !!p.isDecoy,
    status: "open",
    ...coords(i, PROBES.length),
  })),
};

writeFileSync(resolve(import.meta.dir, "answer-sheet.json"), JSON.stringify(answerSheet, null, 2));
writeFileSync(resolve(import.meta.dir, "../contract/vuln-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`wrote answer-sheet.json (${answerSheet.length}) and vuln-manifest.json (${manifest.nodes.length})`);
