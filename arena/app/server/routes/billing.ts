import { Router } from "../framework";
import { db, now } from "../db";
import { requireAuth, currentUser } from "../auth";
import { membershipRole, roleAtLeast, logActivity } from "../util";

export const billingRouter = Router();

billingRouter.use(requireAuth);

billingRouter.get("/:wsId", (req, res) => {
  const user = currentUser(req)!;
  const wsId = Number(req.params.wsId);
  if (!roleAtLeast(membershipRole(wsId, user.id), "member")) {
    return res.status(403).json({ error: "forbidden" });
  }
  const ws = db.query("SELECT id, plan, seats, balance_cents FROM workspaces WHERE id = ?").get(wsId);
  res.json({ billing: ws });
});

// Upgrade or change the workspace plan.
billingRouter.post("/:wsId/upgrade", (req, res) => {
  const user = currentUser(req)!;
  const wsId = Number(req.params.wsId);
  if (!roleAtLeast(membershipRole(wsId, user.id), "admin")) {
    return res.status(403).json({ error: "only admins can change the plan" });
  }
  const { plan, seats, priceCents } = req.body ?? {};
  if (!plan) return res.status(400).json({ error: "plan is required" });
  const seatCount = Number(seats ?? 3);
  const charge = Number(priceCents ?? 0);
  db.query("UPDATE workspaces SET plan = ?, seats = ?, balance_cents = balance_cents - ? WHERE id = ?").run(
    String(plan),
    seatCount,
    charge,
    wsId
  );
  logActivity(wsId, user.id, "billing.upgraded", { plan, seats: seatCount, charge });
  const ws = db.query("SELECT id, plan, seats, balance_cents FROM workspaces WHERE id = ?").get(wsId);
  res.json({ ok: true, billing: ws });
});

// Records the redemption with the billing provider before we grant the credit.
async function recordRedemption(couponId: number, wsId: number) {
  await Bun.sleep(15);
  db.query("INSERT INTO coupon_redemptions (coupon_id, workspace_id, created_at) VALUES (?,?,?)").run(
    couponId,
    wsId,
    now()
  );
}

// Redeem a promo code for account credit.
billingRouter.post("/:wsId/redeem", async (req, res) => {
  const user = currentUser(req)!;
  const wsId = Number(req.params.wsId);
  if (!roleAtLeast(membershipRole(wsId, user.id), "admin")) {
    return res.status(403).json({ error: "only admins can redeem codes" });
  }
  const code = String(req.body?.code ?? "");
  const coupon = db.query("SELECT * FROM coupons WHERE code = ?").get(code) as any;
  if (!coupon) return res.status(404).json({ error: "invalid code" });
  if (coupon.redemptions >= coupon.max_redemptions) {
    return res.status(409).json({ error: "code already redeemed" });
  }
  await recordRedemption(coupon.id, wsId);
  db.query("UPDATE coupons SET redemptions = redemptions + 1 WHERE id = ?").run(coupon.id);
  db.query("UPDATE workspaces SET balance_cents = balance_cents + ? WHERE id = ?").run(
    coupon.credit_cents,
    wsId
  );
  const ws = db.query("SELECT id, plan, balance_cents FROM workspaces WHERE id = ?").get(wsId);
  res.json({ ok: true, credited: coupon.credit_cents, billing: ws });
});
