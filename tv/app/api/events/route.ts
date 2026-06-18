// POST /api/events  — the single ingestion endpoint. ANY producer (the fight
// arena backend, an MCP server, a red/blue agent, a curl, the seed script) sends
// contract envelopes here and they fan out to every connected TV.
//
// Body: one envelope, an array of envelopes, or { control: "reset" }.
// Auth: optional. If INGEST_TOKEN is set, requests must send it as
//       `Authorization: Bearer <token>` or `x-ingest-token: <token>`.
// CORS: open (local multi-process demo); tighten via INGEST_ORIGIN if needed.

import { NextRequest, NextResponse } from "next/server";
import { parseEnvelopes } from "@/lib/ingest";
import { publishMany, resetBuffer, stats } from "@/lib/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 512 * 1024; // 512 KB ceiling per request

function cors(origin: string | null): Record<string, string> {
  const allow = process.env.INGEST_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allow === "*" ? "*" : allow,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, x-ingest-token",
  };
}

function authed(req: NextRequest): boolean {
  const want = process.env.INGEST_TOKEN;
  if (!want) return true; // open by default for the local demo
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = req.headers.get("x-ingest-token");
  return bearer === want || header === want;
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export function GET(req: NextRequest) {
  // health / introspection
  return NextResponse.json({ ok: true, ...stats() }, { headers: cors(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const headers = cors(req.headers.get("origin"));
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers });

  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY) return NextResponse.json({ ok: false, error: "payload too large" }, { status: 413, headers });

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return NextResponse.json({ ok: false, error: "payload too large" }, { status: 413, headers });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400, headers });
  }

  // control messages (e.g. wipe the buffer for a fresh match)
  if (body && typeof body === "object" && !Array.isArray(body) && (body as any).control === "reset") {
    resetBuffer();
    return NextResponse.json({ ok: true, control: "reset" }, { headers });
  }

  const { ok, rejected } = parseEnvelopes(body);
  if (ok.length) publishMany(ok);
  return NextResponse.json({ ok: true, accepted: ok.length, rejected }, { headers });
}
