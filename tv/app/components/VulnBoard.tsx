"use client";

import { motion } from "framer-motion";
import type { VulnData, Vuln, VulnStatus } from "@/lib/useVulns";
import HelpTip from "./HelpTip";

const STATUS: Record<VulnStatus, { label: string; text: string; chip: string; dot: string }> = {
  open: { label: "Open", text: "text-gold", chip: "bg-gold/12 text-gold", dot: "bg-gold" },
  red_scored: { label: "Red scored", text: "text-red", chip: "bg-red/12 text-red", dot: "bg-red" },
  blue_saved: { label: "Blue saved", text: "text-blue", chip: "bg-blue/12 text-blue", dot: "bg-blue" },
};
const DIFF: Record<string, string> = { easy: "text-win", medium: "text-gold", hard: "text-red" };

function owasp(o: string) {
  const m = o.match(/^(A\d{2})[:\s-]*\d*\s*(.*)$/);
  return m ? { tag: m[1], name: m[2] || o } : { tag: "", name: o };
}

export default function VulnBoard({ data, onClose }: { data: VulnData | null; onClose: () => void }) {
  const groups = group(data?.vulns ?? []);
  return (
    <motion.div className="absolute inset-0 z-[55] grid place-items-center p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-ink/85 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.97, y: 14 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}
        transition={{ type: "spring", stiffness: 160, damping: 20 }}
        className="relative card w-[min(1120px,94vw)] h-[min(86vh,840px)] flex flex-col overflow-hidden">

        {/* header */}
        <div className="panel-head px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-[22px] tracking-wide text-text">Target Dossier</span>
              <HelpTip title="How to read this" align="start" side="bottom"
                text="Every real flaw in the app, grouped by OWASP category. Each one lists what it is, where it lives (the endpoint), and how to find it. Decoys are kept off this list." />
            </div>
            <div className="text-[12px] text-mute">{data?.app ?? "Tasklight"} · attack surface</div>
          </div>
          <div className="flex items-center gap-4">
            <ConnBadge connected={!!data?.connected} />
            <button onClick={onClose} className="btn-ghost px-3 py-1.5 text-[12px] font-semibold text-mute hover:text-text">Esc ✕</button>
          </div>
        </div>

        {/* counts strip */}
        <div className="px-6 py-3 flex items-center gap-6 border-b border-white/[0.07]">
          <Stat n={data?.counts.real ?? 0} label="Real vulns" tone="text-text" />
          <Stat n={data?.counts.open ?? 0} label="Open" tone="text-gold" />
          <Stat n={data?.counts.redScored ?? 0} label="Red scored" tone="text-red" />
          <Stat n={data?.counts.blueSaved ?? 0} label="Blue saved" tone="text-blue" />
          <HelpTip title="Status" align="start"
            text="Open: nobody has claimed it yet. Red scored: Red exploited it. Blue saved: Blue patched it before Red could." />
          <span className="ml-auto flex items-center gap-1.5 text-[12px] text-mute/70">
            +{data?.counts.decoys ?? 0} decoys hidden
            <HelpTip title="Decoys" align="end"
              text="Fake flaws that look exploitable but aren't. They stay hidden so the audience can't tip off the players." />
          </span>
        </div>

        {/* grouped list */}
        <div className="feed flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {groups.length === 0 && <div className="text-[13px] text-mute py-10 text-center">Loading dossier…</div>}
          {groups.map(([cat, items]) => {
            const o = owasp(cat);
            return (
              <div key={cat} className="mb-5">
                <div className="flex items-center gap-2.5 mb-2 sticky top-0 bg-[#0e1526]/95 backdrop-blur py-1.5 z-10">
                  {o.tag && <span className="font-display font-bold text-[12px] text-blue px-2 py-0.5 rounded-md bg-blue/12">{o.tag}</span>}
                  <span className="font-display font-bold text-[15px] tracking-wide text-text">{o.name}</span>
                  <span className="text-[11px] font-semibold text-mute">{items.length}</span>
                  <div className="flex-1 h-px bg-white/[0.07] ml-1" />
                </div>
                <div className="grid gap-2">
                  {items.map((v) => <Row key={v.id} v={v} />)}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

function Row({ v }: { v: Vuln }) {
  const s = STATUS[v.status];
  return (
    <div className="rounded-xl bg-white/[0.025] ring-1 ring-white/[0.06] px-4 py-3">
      {/* WHAT + meta */}
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot} ${v.status === "open" ? "animate-pulse" : ""}`} />
        <span className="text-[14px] font-bold text-text flex-1 min-w-0 truncate">{v.title}</span>
        <span className={`text-[10px] font-bold uppercase tracking-[0.06em] ${DIFF[v.difficulty] ?? "text-mute"}`}>{v.difficulty}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${s.chip}`}>{s.label}</span>
      </div>
      {/* WHERE + HOW */}
      <div className="flex items-start gap-4 mt-2 pl-5 text-[12px]">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-faint">↳</span>
          <span className="font-mono text-[11px] text-blue/90 bg-blue/10 px-2 py-0.5 rounded-md whitespace-nowrap">{v.where}</span>
        </div>
        {v.how && (
          <div className="flex items-start gap-1.5 text-mute min-w-0">
            <span className="text-faint shrink-0">⌕</span>
            <span className="font-mono text-[11px] leading-snug">{v.how}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnBadge({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
      <span className={`w-2 h-2 rounded-full ${connected ? "bg-win animate-pulse" : "bg-mute"}`} />
      <span className={`text-[11px] font-semibold ${connected ? "text-win" : "text-mute"}`}>
        {connected ? "Live · arena linked" : "Catalog · arena offline"}
      </span>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`font-display font-bold text-[20px] tabular ${tone}`}>{n}</span>
      <span className="text-[12px] text-mute">{label}</span>
    </div>
  );
}

function group(vulns: Vuln[]): [string, Vuln[]][] {
  const m = new Map<string, Vuln[]>();
  for (const v of vulns) {
    const k = v.owasp || "Other";
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(v);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
