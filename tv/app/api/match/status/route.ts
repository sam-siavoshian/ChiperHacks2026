// GET /api/match/status — is a match running? Proxies to the match runner.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNER = process.env.MATCH_RUNNER_URL || "http://127.0.0.1:8799";

export async function GET() {
  try {
    const res = await fetch(`${RUNNER}/match/status`, { cache: "no-store" });
    const j = await res.json();
    return NextResponse.json({ ok: true, ...j });
  } catch (e: any) {
    return NextResponse.json({ ok: false, running: false, error: e?.message || "runner unreachable" });
  }
}
