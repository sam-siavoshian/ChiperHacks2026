"use client";

import { useEffect, useState } from "react";

export type VulnStatus = "open" | "red_scored" | "blue_saved";
export interface Vuln { id: string; title: string; area: string; owasp: string; difficulty: string; where: string; how: string; status: VulnStatus; }
export interface VulnData {
  app: string;
  connected: boolean;
  control: string;
  score: { red: number; blue: number };
  counts: { real: number; decoys: number; open: number; redScored: number; blueSaved: number };
  vulns: Vuln[];
}

// Polls the TV's /api/vulns (which merges the arena catalog + live board status).
// Light enough to run for the whole session; bumps to a faster cadence while the
// dossier is open.
export function useVulns(activeFast = false): VulnData | null {
  const [data, setData] = useState<VulnData | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/vulns", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as VulnData;
        if (alive) setData(j);
      } catch { /* arena offline; keep last snapshot */ }
    };
    pull();
    const iv = setInterval(pull, activeFast ? 2500 : 6000);
    return () => { alive = false; clearInterval(iv); };
  }, [activeFast]);

  return data;
}

// Overlay the LIVE per-vuln verdicts from the broadcast stream onto the polled
// catalog, and recompute the counts. The poll (/api/vulns -> /board) can lag or be
// unreachable from the Next server; the SSE stream is instant, so a live verdict
// always wins. Counts then move the moment RED scores or BLUE saves.
export function mergeLiveStatus(
  data: VulnData | null,
  vulnStatus: Record<string, "red_scored" | "blue_saved">,
  liveScore: { red: number; blue: number },
): VulnData | null {
  if (!data) return data;
  const hasLive = Object.keys(vulnStatus).length > 0;
  if (!hasLive) return data;
  const vulns = data.vulns.map((v) => {
    const live = vulnStatus[v.id];
    return live && live !== v.status ? { ...v, status: live } : v;
  });
  const redScored = vulns.filter((v) => v.status === "red_scored").length;
  const blueSaved = vulns.filter((v) => v.status === "blue_saved").length;
  return {
    ...data,
    connected: true, // a live verdict on the wire means the arena is linked
    score: liveScore,
    counts: { ...data.counts, open: vulns.length - redScored - blueSaved, redScored, blueSaved },
    vulns,
  };
}
