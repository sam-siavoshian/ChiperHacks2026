"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { MatchConfig, WARMUP_MS } from "@/lib/matchConfig";
import { modelName, findLab } from "@/lib/models";
import LabIcon from "./LabIcon";

// Launch -> live window. Counts down WARMUP_MS while the arena boots and the
// narrator LLM + TTS prime, then reveals the broadcast.
export default function GeneratingScreen({ cfg, startedAt, onReady }: { cfg: MatchConfig; startedAt: number; onReady: () => void }) {
  const [pct, setPct] = useState(0);
  const fired = useRef(false);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - startedAt) / WARMUP_MS);
      setPct(k);
      if (k >= 1 && !fired.current) { fired.current = true; onReady(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startedAt, onReady]);

  const secs = Math.ceil((WARMUP_MS * (1 - pct)) / 1000);
  const steps = [
    { at: 0.05, label: "Booting target app" },
    { at: 0.2, label: `Spawning Red — ${modelName(cfg.red.lab, cfg.red.model)}` },
    { at: 0.38, label: `Spawning Blue — ${modelName(cfg.blue.lab, cfg.blue.model)}` },
    { at: 0.55, label: "Pre-seeding recon + board" },
    { at: 0.72, label: "Priming narrator" },
    { at: 0.85, label: "Warming broadcast voice" },
    { at: 0.95, label: "Opening the feed" },
  ];

  return (
    <main className="relative h-screen w-screen stadium grid-veil overflow-hidden grid place-items-center">
      <div className="relative w-[min(680px,92vw)] text-center">
        <div className="kicker text-[12px] text-lime mb-6">Generating match</div>

        <div className="flex items-center justify-center gap-5 mb-10">
          <Kit side="red" lab={cfg.red.lab} model={cfg.red.model} />
          <div className="font-display font-bold text-[26px] text-mute">VS</div>
          <Kit side="blue" lab={cfg.blue.lab} model={cfg.blue.model} />
        </div>

        <div className="relative w-32 h-32 mx-auto mb-9">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
            <motion.circle cx="50" cy="50" r="45" fill="none" stroke="#b8ff3b" strokeWidth="5" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 45} strokeDashoffset={2 * Math.PI * 45 * (1 - pct)}
              style={{ filter: "drop-shadow(0 0 8px rgba(184,255,59,.6))" }} />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <span className="font-display font-bold text-[40px] text-text tabular">{secs}</span>
          </div>
        </div>

        <div className="mx-auto max-w-[420px] grid gap-2 text-left">
          {steps.map((s, i) => {
            const done = pct >= s.at;
            const active = !done && (i === 0 || pct >= steps[i - 1].at);
            return (
              <div key={i} className="flex items-center gap-3 text-[14px]">
                <span className={`w-5 h-5 rounded-full grid place-items-center text-[11px] shrink-0 ${done ? "bg-win text-ink" : active ? "bg-lime/20 text-lime" : "bg-white/5 text-faint"}`}>
                  {done ? "✓" : active ? "•" : ""}
                </span>
                <span className={done ? "text-[#aeb9d2]" : active ? "text-text font-semibold" : "text-faint"}>{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function Kit({ side, lab, model }: { side: "red" | "blue"; lab: string; model: string }) {
  const color = side === "red" ? "#ff3b50" : "#2e90ff";
  const l = findLab(lab);
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="card px-5 py-4 min-w-[210px] text-left" style={{ boxShadow: `0 24px 60px -34px ${color}` }}>
      <div className="font-display font-bold text-[18px]" style={{ color }}>{side.toUpperCase()}</div>
      <div className="flex items-center gap-1.5 mt-1">
        <LabIcon labId={lab} size={15} />
        <span className="text-[12px] font-semibold text-mute">{l?.name}</span>
      </div>
      <div className="font-display font-bold text-[20px] text-text mt-0.5">{modelName(lab, model)}</div>
    </motion.div>
  );
}
