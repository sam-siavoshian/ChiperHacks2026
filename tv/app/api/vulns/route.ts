// GET /api/vulns — the target's real vulnerability dossier for the TV.
//
// Source of truth is the arena's catalog (contract/vuln-manifest.json): titles,
// OWASP class, area, difficulty, decoy flag. Live per-vuln status (open /
// red_scored / blue_saved) and the board score come from the arena control plane
// (GET <ARENA_CONTROL_URL>/board). If the arena is offline we still return the
// real catalog so the dossier always shows — just without live status.
//
//   ARENA_CONTROL_URL   default http://127.0.0.1:4100
//   ARENA_MANIFEST_PATH default ../arena/contract/vuln-manifest.json (rel. to tv/)

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import bundled from "@/lib/vuln-manifest.json";
import { VULN_INFO } from "@/lib/vuln-info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ManifestNode {
  id: string; title: string; area: string; owasp: string;
  difficulty: string; isDecoy: boolean; status?: string; x?: number; y?: number;
}
type LiveStatus = "open" | "red_scored" | "blue_saved";

const CONTROL = process.env.ARENA_CONTROL_URL || "http://127.0.0.1:4100";

async function loadCatalog(): Promise<ManifestNode[]> {
  const path = process.env.ARENA_MANIFEST_PATH || resolve(process.cwd(), "../arena/contract/vuln-manifest.json");
  try {
    const txt = await readFile(path, "utf8");
    const j = JSON.parse(txt);
    if (Array.isArray(j?.nodes)) return j.nodes as ManifestNode[];
  } catch { /* fall back to the copy bundled with the TV */ }
  return (bundled as any).nodes as ManifestNode[];
}

async function loadLive(): Promise<{ connected: boolean; red: number; blue: number; status: Map<string, LiveStatus> }> {
  const status = new Map<string, LiveStatus>();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(`${CONTROL}/board`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) return { connected: false, red: 0, blue: 0, status };
    const board = await res.json();
    for (const c of board.cells ?? []) if (c?.id && c?.status) status.set(c.id, c.status);
    return { connected: true, red: board.red ?? 0, blue: board.blue ?? 0, status };
  } catch {
    return { connected: false, red: 0, blue: 0, status };
  }
}

export async function GET() {
  const [catalog, live] = await Promise.all([loadCatalog(), loadLive()]);

  const real = catalog.filter((n) => !n.isDecoy);
  const decoys = catalog.filter((n) => n.isDecoy);

  const vulns = real.map((n) => {
    const info = VULN_INFO[n.id];
    return {
      id: n.id,
      title: n.title,
      area: n.area,
      owasp: n.owasp,
      difficulty: n.difficulty,
      // `where` = endpoint, `how` = one-line method to find it (manifest overrides)
      where: (n as any).where ?? info?.where ?? n.area,
      how: (n as any).how ?? info?.how ?? "",
      status: (live.status.get(n.id) ?? "open") as LiveStatus,
    };
  });

  const scored = vulns.filter((v) => v.status === "red_scored").length;
  const saved = vulns.filter((v) => v.status === "blue_saved").length;

  return NextResponse.json({
    app: (bundled as any).app ?? "Tasklight",
    connected: live.connected,
    control: CONTROL,
    score: { red: live.red, blue: live.blue },
    counts: { real: real.length, decoys: decoys.length, open: vulns.length - scored - saved, redScored: scored, blueSaved: saved },
    vulns,
  });
}
