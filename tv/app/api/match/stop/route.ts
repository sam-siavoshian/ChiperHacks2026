// POST /api/match/stop — end the running match. Proxies to the match runner.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNER = process.env.MATCH_RUNNER_URL || "http://127.0.0.1:8799";

export async function POST() {
  try {
    const res = await fetch(`${RUNNER}/match/stop`, { method: "POST" });
    return NextResponse.json({ ok: res.ok });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "runner unreachable" });
  }
}
