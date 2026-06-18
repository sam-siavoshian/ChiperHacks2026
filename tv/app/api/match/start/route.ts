// POST /api/match/start — the single "launch the match" entry point for the TV.
// Takes the operator's model config and fans it out to the rest of the system:
//   1. boots the match on the arena control plane (ARENA_CONTROL_URL/match/start)
//   2. (optional) pings a narrator/TTS warmup hook so the voice is primed during
//      the ~15s generating window before the broadcast shows.
// Best-effort: if a downstream is down, launch still succeeds so the TV proceeds
// to the broadcast (which will fill in once real events arrive).
//
//   ARENA_CONTROL_URL    default http://127.0.0.1:4100
//   NARRATOR_WARMUP_URL  optional; POSTed the same config to prime TTS/narrator

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTROL = process.env.ARENA_CONTROL_URL || "http://127.0.0.1:4100";
const RUNNER = process.env.MATCH_RUNNER_URL || "http://127.0.0.1:8799";
const WARMUP = process.env.NARRATOR_WARMUP_URL || "";

async function postJson(url: string, body: unknown, ms: number): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return { ok: res.ok, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.message || "unreachable" };
  }
}

export async function POST(req: NextRequest) {
  let cfg: any;
  try { cfg = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }

  const red = cfg?.red, blue = cfg?.blue;
  if (!red?.lab || !red?.model || !blue?.lab || !blue?.model) {
    return NextResponse.json({ ok: false, error: "config requires red.{lab,model} and blue.{lab,model}" }, { status: 400 });
  }

  const payload = {
    red: { lab: String(red.lab), model: String(red.model) },
    blue: { lab: String(blue.lab), model: String(blue.model) },
    rounds: Number(cfg?.rounds) || 25,
  };

  // Start the FULL match via the runner service (it boots the arena, spawns the
  // RED + BLUE sessions, drives the turns, and emits to this TV). Fall back to
  // booting just the arena board if the runner is down — best-effort either way.
  let started = await postJson(`${RUNNER}/match/start`, payload, 8000);
  if (!started.ok) started = await postJson(`${CONTROL}/match/start`, payload, 4000);
  // prime narrator/TTS if a hook is configured
  const warmup = WARMUP ? await postJson(WARMUP, payload, 2000) : { ok: false, error: "not configured" };

  return NextResponse.json({
    ok: true,
    startedAt: Date.now(),
    config: payload,
    arena: { reached: started.ok, ...(started.error ? { error: started.error } : {}) },
    narrator: { reached: warmup.ok },
  });
}
