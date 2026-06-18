"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ArenaState, FeedLine, BlueRule } from "@/lib/arenaState";
import HelpTip from "./HelpTip";
import LabIcon from "./LabIcon";

const ROW_COLOR: Record<FeedLine["kind"], string> = {
  detect: "text-gold", mitigate: "text-blue", blocked: "text-win",
  attempt: "text-[#9fb0cc]", vuln: "text-gold", win: "text-red", info: "text-mute",
  handoff: "text-text", error: "text-red/80",
};

export default function BlueRail({ state, lab, model }: { state: ArenaState; lab?: string; model?: string }) {
  return (
    <div className="card flex flex-col h-full min-h-0 overflow-hidden">
      <div className="panel-head px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-blue" />
          <span className="font-display font-bold text-[16px] tracking-wide text-text">Blue</span>
          <HelpTip title="Blue — defender" tone="#2e90ff" align="start" side="bottom"
            text="The defending AI. It watches every request, spots attacks, and deploys live patches to block them before Red can score." />
        </div>
        {model && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-mute">
            {lab && <LabIcon labId={lab} size={13} />}{model}
          </span>
        )}
      </div>

      <Integrity health={state.health} owned={state.assetsOwned} />

      <div className="px-4 pt-3 pb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-faint">Live rules</span>
          <HelpTip title="Live rules" tone="#2e90ff" align="start" side="top"
            text="Patches Blue has deployed this round. Each one blocks a specific attack. The counter shows how many times a rule has stopped Red." />
        </span>
        <span className="text-[11px] font-bold text-blue">{state.rules.length} active</span>
      </div>
      <div className="px-3 grid gap-1.5 max-h-[150px] overflow-y-auto feed">
        <AnimatePresence initial={false}>
          {state.rules.slice(-5).reverse().map((r) => <Rule key={r.id} r={r} />)}
        </AnimatePresence>
        {state.rules.length === 0 && <div className="text-[11px] text-mute/60 px-1 py-2 font-mono">no rules deployed</div>}
      </div>

      <div className="px-4 pt-4 pb-2 text-[10px] font-bold tracking-[0.12em] uppercase text-faint">Console</div>
      <Feed lines={state.feedBlue} />
    </div>
  );
}

function Integrity({ health, owned }: { health: number; owned: number }) {
  const tone = health > 60 ? "#36e0a0" : health > 30 ? "#ffcf4a" : "#ff3b50";
  return (
    <div className="px-4 pt-3.5">
      <div className="flex items-center justify-between text-[11px] mb-1.5">
        <span className="flex items-center gap-1.5">
          <span className="font-semibold text-mute">Target integrity</span>
          <HelpTip text="How much of the app is still secure this round. It drops each time Red compromises part of the target." align="start" />
        </span>
        <span className="font-display font-bold text-[16px] tabular" style={{ color: tone }}>{health}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
        <motion.div className="h-full rounded-full" style={{ background: tone, boxShadow: `0 0 12px ${tone}88` }}
          animate={{ width: `${health}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
      </div>
      <div className="text-[11px] text-mute mt-1.5">{owned} asset{owned === 1 ? "" : "s"} compromised this round</div>
    </div>
  );
}

function Rule({ r }: { r: BlueRule }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96, x: 8 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0 }}
      className="rounded-xl ring-1 ring-blue/40 bg-blue/[0.08] px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-blue">⛨ {r.action.replace(/_/g, " ")}</span>
        {r.hits > 0 && <span className="text-[10px] font-bold text-win">×{r.hits} blocked</span>}
      </div>
      <div className="text-[11px] text-[#b9c5dc] truncate mt-0.5 font-mono">{r.label}</div>
    </motion.div>
  );
}

function Feed({ lines }: { lines: FeedLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  const shown = lines.slice(-18);
  return (
    <div ref={ref} className="feed flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1 font-mono text-[11px] leading-snug">
      <AnimatePresence initial={false}>
        {shown.map((l) => (
          <motion.div key={l.id} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
            className="flex gap-1.5">
            <span className={`${ROW_COLOR[l.kind]} whitespace-nowrap font-medium`}>{l.text}</span>
            {l.sub && <span className="text-mute/70 truncate">{l.sub}</span>}
            {l.n && l.n > 1 && <span className="text-mute/60 shrink-0">×{l.n}</span>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
