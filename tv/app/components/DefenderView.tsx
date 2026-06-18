"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { DefenderView as DV, BudgetHUD } from "@/lib/arenaState";
import ToolBudget from "./ToolBudget";

const PHASE: Record<DV["phase"], { label: string; color: string }> = {
  watching: { label: "WATCHING", color: "#8a97b4" },
  detected: { label: "THREAT CAUGHT", color: "#ffcf4a" },
  patched: { label: "PATCH DEPLOYED", color: "#2e90ff" },
  blocked: { label: "ATTACK BLOCKED", color: "#36e0a0" },
};

const STEPS: { key: DV["phase"]; icon: string; label: string }[] = [
  { key: "detected", icon: "◎", label: "Detect" },
  { key: "patched", icon: "⛨", label: "Patch" },
  { key: "blocked", icon: "✕", label: "Block" },
];
const ORDER: DV["phase"][] = ["watching", "detected", "patched", "blocked"];

// ambient WAF traffic sample — deterministic from the clock so the monitor keeps
// scrolling between real beats (broadcast flavor, clearly framed as a sample).
const SAMPLE = [
  "GET /api/tasks", "GET /api/me", "POST /api/search", "GET /api/workspaces",
  "GET /api/files/3", "POST /api/comments", "GET /api/reports/tasks", "GET /api/config",
];
function ambientLines(now: number, accent: string) {
  const bucket = Math.floor(now / 700);
  return [0, 1, 2, 3].map((i) => {
    const k = (bucket - i) % SAMPLE.length;
    const ep = SAMPLE[(k + SAMPLE.length) % SAMPLE.length];
    const flagged = ((bucket - i) % 7) === 0;
    return { id: `${bucket - i}`, ep, status: flagged ? "200 · inspected" : "200 · clean", color: flagged ? accent : "#5f6e8e" };
  });
}

export default function DefenderView({ defender, rulesCount, budget, now }: { defender: DV | null; rulesCount: number; budget: BudgetHUD | null; now: number }) {
  const ph = defender ? PHASE[defender.phase] : PHASE.watching;
  const accent = ph.color;
  const reached = (k: DV["phase"]) => (defender ? ORDER.indexOf(defender.phase) >= ORDER.indexOf(k) : false);

  // ever-rising "requests inspected" counter so the console never looks idle
  const mountRef = useRef(0);
  if (mountRef.current === 0) mountRef.current = now || 1;
  const inspected = 128 + Math.floor((now - mountRef.current) / 180);
  const blockedN = defender?.phase === "blocked" ? (defender.status ?? 403) : null;

  // typewriter for the deployed patch body
  const patchStr = defender?.rule && Object.keys(defender.rule).length ? JSON.stringify(defender.rule, null, 2) : "";
  const [patchAt, setPatchAt] = useState(0);
  const lastPatch = useRef(0);
  useEffect(() => {
    if (defender && defender.phase === "patched" && defender.at !== lastPatch.current) {
      lastPatch.current = defender.at; setPatchAt(defender.at);
    }
  }, [defender?.at, defender?.phase]);
  const patchShown = patchStr ? patchStr.slice(0, Math.max(0, Math.floor((now - patchAt) / 6))) : "";

  return (
    <div className="absolute inset-0 flex flex-col p-3 pb-[104px]">
      <div className="flex-1 min-h-0 card overflow-hidden flex flex-col">
        {/* console chrome + meters */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
          <span className="w-7 h-7 rounded-lg grid place-items-center text-[15px] bg-blue/15 border border-blue/40">🛡</span>
          <div className="leading-tight">
            <div className="font-display font-bold text-[14px] tracking-wide text-text">Blue Defender</div>
            <div className="text-[11px] text-mute">Live WAF console</div>
          </div>
          <div className="flex-1" />
          <ToolBudget hud={budget} tone="#2e90ff" now={now} />
          <span className="w-px h-6 bg-white/10" />
          <Meter label="INSPECTED" value={String(inspected)} tone="#36e0a0" />
          <Meter label="RULES" value={String(rulesCount)} tone="#2e90ff" />
          {defender?.target && <span className="font-mono text-[12px] text-blue/90 bg-blue/10 px-2 py-1 rounded-md truncate max-w-[200px]">{defender.target}</span>}
          <span className="text-[11px] font-bold px-2 py-1 rounded-md slam-in" key={ph.label} style={{ background: `${accent}22`, color: accent }}>{ph.label}</span>
        </div>

        {/* detect -> patch -> block pipeline, with marching wire between live steps */}
        <div className="shrink-0 flex items-center justify-center gap-2 py-4 border-b border-white/10">
          {STEPS.map((s, i) => {
            const on = reached(s.key);
            const active = defender?.phase === s.key;
            const col = s.key === "blocked" ? "#36e0a0" : "#2e90ff";
            return (
              <div key={s.key} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1">
                  <div className="relative">
                    {active && <span className="absolute inset-0 rounded-full ping-ring border" style={{ borderColor: `${col}88` }} />}
                    <span className={`relative w-9 h-9 rounded-full grid place-items-center text-[15px] transition-all ${active ? "scale-110" : ""}`}
                      style={on ? { background: `${col}22`, color: col, boxShadow: active ? `0 0 16px ${col}66` : "none", border: `1px solid ${col}66` } : { background: "rgba(255,255,255,0.04)", color: "#5a6684", border: "1px solid rgba(255,255,255,0.08)" }}>
                      {s.icon}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: on ? col : "#5a6684" }}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="w-10 h-[2px] self-start mt-[18px]" style={{ color: "#2e90ff" }}>
                    {reached(STEPS[i + 1].key) ? <div className="flow-wire w-full h-full" /> : <div className="w-full h-full" style={{ background: "rgba(255,255,255,0.1)" }} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* detail — the threat / patch code / block proof */}
        <div className="flex-1 min-h-0 relative overflow-hidden">
          <div className="scanbar blue z-0" />
          <div className="relative z-10 h-full p-5 overflow-y-auto feed grid place-items-center">
            <AnimatePresence mode="wait">
              {!defender || defender.phase === "watching" ? (
                <motion.div key="watch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-[460px]">
                  <div className="text-center mb-3">
                    <div className="font-display font-bold text-[20px] text-text">Watching every request</div>
                    <div className="text-[13px] text-mute mt-1">{rulesCount} rule{rulesCount === 1 ? "" : "s"} live · 0 threats. Blue patches the moment it spots an attack.</div>
                  </div>
                  <div className="rounded-xl bg-black/40 border border-white/10 px-4 py-2.5 font-mono text-[12px] leading-[1.6]">
                    {ambientLines(now, accent).map((l) => (
                      <div key={l.id} className="flex items-center justify-between gap-3 truncate">
                        <span className="text-[#9fb0d0] truncate">‹ {l.ep}</span>
                        <span className="shrink-0" style={{ color: l.color }}>{l.status}</span>
                      </div>
                    ))}
                    <div className="text-faint">$ sampling traffic<span className="cursor-blink" /></div>
                  </div>
                </motion.div>
              ) : defender.phase === "blocked" ? (
                <motion.div key="blocked" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
                  <div className="font-display font-bold text-[68px] leading-none text-win slam-in" key={blockedN ?? "b"} style={{ textShadow: "0 0 22px rgba(54,224,160,.55)" }}>{blockedN ?? 403}</div>
                  <div className="font-display font-bold text-[22px] text-text mt-1">Attack blocked</div>
                  <div className="text-[12px] text-win/80 mt-1">same payload · stopped cold</div>
                  <div className="font-mono text-[12px] text-mute mt-2 truncate max-w-[420px] mx-auto">{defender.target}</div>
                </motion.div>
              ) : defender.phase === "patched" || defender.rule || defender.action ? (
                <motion.div key="patch" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[520px]">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint mb-2">Patch deployed</div>
                  <div className="rounded-xl bg-black/40 border border-blue/30 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between">
                      <span className="font-mono text-[13px] text-blue font-semibold">{defender.action?.replace(/_/g, " ") || "patch"}</span>
                      {defender.label && <span className="text-[12px] text-[#b9c5dc] truncate ml-3">{defender.label}</span>}
                    </div>
                    {patchStr && (
                      <pre className="px-4 py-3 font-mono text-[12px] leading-relaxed text-win/90 overflow-x-auto">{patchShown}{patchShown.length < patchStr.length && <span className="cursor-blink" />}</pre>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div key="detect" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
                  <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-gold mb-2">⚠ Threat caught</div>
                  <div className="font-display font-bold text-[24px] text-text">{defender.threat ?? "Suspicious request"}</div>
                  <div className="text-[13px] text-mute mt-1">Blue is writing a patch<span className="cursor-blink" /></div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meter({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex flex-col items-end leading-none">
      <span className="font-mono text-[12px] font-bold tabular" style={{ color: tone }}>{value}</span>
      <span className="text-[8px] font-bold tracking-[0.12em] text-faint mt-0.5">{label}</span>
    </div>
  );
}
