"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { DefenderView as DV } from "@/lib/arenaState";

const PHASE: Record<DV["phase"], { label: string; color: string }> = {
  watching: { label: "Watching", color: "#8a97b4" },
  detected: { label: "Threat caught", color: "#ffcf4a" },
  patched: { label: "Patch deployed", color: "#2e90ff" },
  blocked: { label: "Attack blocked", color: "#36e0a0" },
};

const STEPS: { key: DV["phase"]; icon: string; label: string }[] = [
  { key: "detected", icon: "◎", label: "Detect" },
  { key: "patched", icon: "⛨", label: "Patch" },
  { key: "blocked", icon: "✕", label: "Block" },
];
const ORDER: DV["phase"][] = ["watching", "detected", "patched", "blocked"];

export default function DefenderView({ defender, rulesCount }: { defender: DV | null; rulesCount: number }) {
  const ph = defender ? PHASE[defender.phase] : PHASE.watching;
  const reached = (k: DV["phase"]) => defender ? ORDER.indexOf(defender.phase) >= ORDER.indexOf(k) : false;

  return (
    <div className="absolute inset-0 flex flex-col p-3 pb-[104px]">
      <div className="flex-1 min-h-0 card overflow-hidden flex flex-col">
        {/* console chrome */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
          <span className="w-7 h-7 rounded-lg grid place-items-center text-[15px] bg-blue/15 border border-blue/40">🛡</span>
          <div className="leading-tight">
            <div className="font-display font-bold text-[14px] tracking-wide text-text">Blue Defender</div>
            <div className="text-[11px] text-mute">Live WAF console</div>
          </div>
          <div className="flex-1" />
          {defender?.target && <span className="font-mono text-[12px] text-blue/90 bg-blue/10 px-2 py-1 rounded-md truncate max-w-[260px]">{defender.target}</span>}
          <span className="text-[11px] font-bold px-2 py-1 rounded-md" style={{ background: `${ph.color}22`, color: ph.color }}>{ph.label}</span>
        </div>

        {/* detect -> patch -> block pipeline */}
        <div className="shrink-0 flex items-center justify-center gap-2 py-4 border-b border-white/10">
          {STEPS.map((s, i) => {
            const on = reached(s.key);
            const active = defender?.phase === s.key;
            const col = s.key === "blocked" ? "#36e0a0" : "#2e90ff";
            return (
              <div key={s.key} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1">
                  <span className={`w-9 h-9 rounded-full grid place-items-center text-[15px] transition-all ${active ? "scale-110" : ""}`}
                    style={on ? { background: `${col}22`, color: col, boxShadow: active ? `0 0 16px ${col}66` : "none", border: `1px solid ${col}66` } : { background: "rgba(255,255,255,0.04)", color: "#5a6684", border: "1px solid rgba(255,255,255,0.08)" }}>
                    {s.icon}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: on ? col : "#5a6684" }}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <span className="w-10 h-px" style={{ background: reached(STEPS[i + 1].key) ? "#2e90ff66" : "rgba(255,255,255,0.1)" }} />}
              </div>
            );
          })}
        </div>

        {/* the detail — threat / the deployed patch as code / block proof */}
        <div className="flex-1 min-h-0 p-5 overflow-y-auto feed grid place-items-center">
          <AnimatePresence mode="wait">
            {!defender ? (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
                <div className="font-display font-bold text-[20px] text-text">Watching every request</div>
                <div className="text-[13px] text-mute mt-1">{rulesCount} rule{rulesCount === 1 ? "" : "s"} live. Blue patches the moment it spots an attack.</div>
              </motion.div>
            ) : defender.phase === "blocked" ? (
              <motion.div key="blocked" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
                <div className="font-display font-bold text-[64px] leading-none text-win" style={{ textShadow: "0 0 18px rgba(54,224,160,.5)" }}>{defender.status ?? 403}</div>
                <div className="font-display font-bold text-[22px] text-text mt-1">Attack blocked</div>
                <div className="font-mono text-[12px] text-mute mt-2 truncate max-w-[420px] mx-auto">{defender.target}</div>
              </motion.div>
            ) : defender.rule || defender.action ? (
              <motion.div key="patch" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[520px]">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint mb-2">Patch deployed</div>
                <div className="rounded-xl bg-black/40 border border-blue/30 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between">
                    <span className="font-mono text-[13px] text-blue font-semibold">{defender.action?.replace(/_/g, " ")}</span>
                    {defender.label && <span className="text-[12px] text-[#b9c5dc] truncate ml-3">{defender.label}</span>}
                  </div>
                  {defender.rule && Object.keys(defender.rule).length > 0 && (
                    <pre className="px-4 py-3 font-mono text-[12px] leading-relaxed text-win/90 overflow-x-auto">{JSON.stringify(defender.rule, null, 2)}</pre>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div key="detect" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-gold mb-2">Threat caught</div>
                <div className="font-display font-bold text-[22px] text-text">{defender.threat ?? "Suspicious request"}</div>
                <div className="text-[13px] text-mute mt-1">Blue is writing a patch…</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
