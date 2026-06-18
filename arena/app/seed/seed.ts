import { db, migrate, now } from "../server/db";
import { hashPassword } from "../server/auth";

// Rebuild the database from scratch so seeded IDs are deterministic.
function reset() {
  for (const t of [
    "activity",
    "integrations",
    "api_tokens",
    "coupon_redemptions",
    "coupons",
    "invites",
    "files",
    "comments",
    "tasks",
    "projects",
    "members",
    "workspaces",
    "users",
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${t};`);
  }
  migrate();
}

function seed() {
  reset();
  const ts = 1_700_000_000;

  const users = [
    { email: "admin@tasklight.io", name: "Tasklight Admin", pw: "Zx9!adminVault2026", role: "admin" },
    { email: "maya@acme.test", name: "Maya Chen", pw: "maya-password-123", role: "user" },
    { email: "leo@acme.test", name: "Leo Park", pw: "leo-password-123", role: "user" },
    { email: "nina@globex.test", name: "Nina Volkov", pw: "nina-password-123", role: "user" },
    { email: "sam@acme.test", name: "Sam Idris", pw: "sam-password-123", role: "user" },
  ];
  for (const u of users) {
    db.query(
      "INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?,?,?)"
    ).run(u.email, u.name, hashPassword(u.pw), u.role, ts);
  }
  // ids: 1 admin, 2 maya, 3 leo, 4 nina, 5 sam

  db.query(
    "INSERT INTO workspaces (name, slug, owner_id, plan, seats, balance_cents, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run("Acme Corp", "acme", 3, "pro", 10, 0, ts); // ws 1
  db.query(
    "INSERT INTO workspaces (name, slug, owner_id, plan, seats, balance_cents, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run("Globex Holdings", "globex", 4, "enterprise", 25, 0, ts); // ws 2

  const members = [
    [1, 3, "owner"],
    [1, 2, "admin"],
    [1, 5, "guest"],
    [2, 4, "owner"],
  ];
  for (const [ws, uid, role] of members) {
    db.query(
      "INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?,?,?,?)"
    ).run(ws, uid, role, ts);
  }

  db.query("INSERT INTO projects (workspace_id, name, key, created_at) VALUES (?,?,?,?)").run(1, "Website Relaunch", "WEB", ts); // p1
  db.query("INSERT INTO projects (workspace_id, name, key, created_at) VALUES (?,?,?,?)").run(2, "Project Falcon", "FAL", ts); // p2

  // Website Relaunch tasks
  db.query(
    "INSERT INTO tasks (project_id, workspace_id, title, description, status, priority, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(1, 1, "Redesign landing page", "Update hero and pricing.", "todo", "high", 3, ts); // t1
  db.query(
    "INSERT INTO tasks (project_id, workspace_id, title, description, status, priority, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(1, 1, "Fix navbar on mobile", "Menu overflows on small screens.", "in_progress", "medium", 2, ts); // t2

  // Project Falcon tasks
  db.query(
    "INSERT INTO tasks (project_id, workspace_id, title, description, status, priority, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(
    2,
    2,
    "Confidential: acquisition of Initech",
    "Board-only. Offer is 4.2B. Do not share outside Globex leadership.",
    "todo",
    "high",
    4,
    ts
  ); // t3

  db.query("INSERT INTO comments (task_id, author_id, body, created_at) VALUES (?,?,?,?)").run(
    1,
    3,
    "Looks good, ship it.",
    ts
  );

  // Project Falcon attachments
  db.query(
    "INSERT INTO files (workspace_id, task_id, owner_id, filename, stored_name, content_type, size, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(2, 3, 4, "falcon-financials.txt", "seed-falcon-financials.txt", "text/plain", 64, ts); // f1
  db.query(
    "INSERT INTO files (workspace_id, task_id, owner_id, filename, stored_name, content_type, size, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(1, 1, 3, "brand-guide.txt", "seed-brand-guide.txt", "text/plain", 32, ts); // f2

  db.query("INSERT INTO coupons (code, credit_cents, max_redemptions, redemptions) VALUES (?,?,?,?)").run(
    "LAUNCH50",
    5000,
    1,
    0
  );

  db.query("INSERT INTO integrations (workspace_id, name, webhook_url, created_at) VALUES (?,?,?,?)").run(
    1,
    "Slack",
    "https://hooks.slack.test/services/T000/B000/xxxx",
    ts
  );

  // Flush the WAL into the main database file so the seed is a single
  // self-contained file that can be copied for a clean per-turn reset.
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");

  console.log("seed complete:", {
    users: users.length,
    workspaces: 2,
    tasks: 3,
    coupon: "LAUNCH50",
  });
}

seed();
