import { test, expect } from "bun:test";
import { Match } from "../orchestrator/match";

// Battle test of the judge's integrity — the property the whole benchmark rests
// on: a claim scores IFF the attacker actually landed that specific exploit.
// False positives (scoring an undemonstrated bug) invalidate the game; false
// negatives (denying a real exploit) make it unwinnable.

// Canonical (class, path) an attacker would submit for each planted vuln.
const CLAIMS: Record<string, [string, string]> = {
  "sqli-login": ["sqli", "/api/auth/login"],
  "jwt-weak-secret": ["jwt", "/api/auth/me"],
  "predictable-reset-token": ["reset", "/api/auth/reset"],
  "user-enumeration": ["enumeration", "/api/auth/forgot"],
  "mass-assignment-role": ["massassignment", "/api/users/me"],
  "idor-task": ["idor", "/api/tasks/3"],
  "idor-file": ["idor", "/api/files/1"],
  "missing-admin-authz": ["adminauthz", "/api/admin/users"],
  "broken-role-check": ["rolecheck", "/api/workspaces/1/members/2/role"],
  "stored-xss": ["xss", "/api/tasks/1/export.html"],
  "sqli-search": ["sqli", "/api/search"],
  "sqli-reports": ["sqli", "/api/reports/tasks"],
  "ssrf-integration": ["ssrf", "/api/integrations/1/test"],
  "ssrf-avatar": ["ssrf", "/api/users/me/avatar"],
  "path-traversal": ["traversal", "/api/files/download"],
  "unrestricted-upload": ["upload", "/api/files"],
  "price-tampering": ["price", "/api/billing/1/upgrade"],
  "coupon-race": ["race", "/api/billing/1/redeem"],
  "secrets-exposure": ["secrets", "/api/config"],
  "open-redirect": ["redirect", "/api/auth/sso/callback"],
};

test("every planted vuln scores with its canonical claim", async () => {
  const m = new Match({ port: 4073, mockPort: 9313 });
  await m.start();
  try {
    const failed: string[] = [];
    for (const [vulnId, [cls, path]] of Object.entries(CLAIMS)) {
      const v = await m.claim(cls, path, "battle-test");
      if (!(v.scored && v.vulnId === vulnId)) {
        failed.push(`${vulnId}: claim(${cls},${path}) -> scored=${v.scored} vulnId=${v.vulnId}`);
      }
    }
    expect(failed, `unscored/misrouted vulns:\n${failed.join("\n")}`).toEqual([]);
    // All 20 real vulns claimed -> board is fully red, match over.
    expect(m.state().over).toBe(true);
  } finally {
    await m.stop();
  }
}, 120000);

test("bad claims never score", async () => {
  const m = new Match({ port: 4074, mockPort: 9314 });
  await m.start();
  try {
    const bad: Array<[string, string, string]> = [
      ["sqli", "/api/health", "wrong endpoint for class"],
      ["sqli", "/api/auth/forgot", "no sqli on forgot"],
      ["xss", "/api/billing/1/upgrade", "wrong class for endpoint"],
      ["idor", "/api/config", "no idor on config"],
      ["commandinjection", "/api/net/ping", "decoy — safe resolver"],
      ["sqli", "/api/directory", "decoy — parameterized"],
      ["ssti", "/api/preview", "decoy — eval path dead"],
      ["", "", "empty claim"],
      ["sqli'; DROP TABLE users;--", "/api/../../etc/passwd", "garbage/injection in claim fields"],
      ["rce", "/api/auth/login", "class not present anywhere"],
      // Adversarial: a junk class must NOT let the judge farm the endpoint's bug.
      ["xyz", "/api/admin/users", "junk class farming a real endpoint vuln"],
      ["unknown", "/api/users/me/avatar", "junk class on a multi-route path"],
      ["whatever", "/api/auth/login", "junk class on a known-vulnerable endpoint"],
      // Broad class + irrelevant path must not auto-score the cross-cutting JWT bug.
      ["auth", "/api/admin/users", "broad auth class on an irrelevant path"],
    ];
    const scored: string[] = [];
    for (const [cls, path, why] of bad) {
      const v = await m.claim(cls, path, why);
      if (v.scored) scored.push(`${cls} ${path} (${why}) -> scored vulnId=${v.vulnId}`);
    }
    expect(scored, `bad claims that wrongly scored:\n${scored.join("\n")}`).toEqual([]);
    expect(m.state().red).toBe(0);
  } finally {
    await m.stop();
  }
}, 90000);

test("a vuln cannot be double-scored", async () => {
  const m = new Match({ port: 4075, mockPort: 9315 });
  await m.start();
  try {
    const first = await m.claim("sqli", "/api/auth/login", "first");
    expect(first.scored).toBe(true);
    const redAfterFirst = m.state().red;
    const second = await m.claim("sqli", "/api/auth/login", "replay");
    expect(second.scored).toBe(false);
    expect(m.state().red).toBe(redAfterFirst);
  } finally {
    await m.stop();
  }
}, 60000);
