"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ArenaState, FeedLine } from "@/lib/arenaState";
import HelpTip from "./HelpTip";
import LabIcon from "./LabIcon";

const AGENTS: { id: string; name: string; role: string }[] = [
  { id: "recon", name: "Recon", role: "maps the app's endpoints" },
  { id: "web_exploit", name: "Web Exploit", role: "exploits the flaws it finds" },
  { id: "auth", name: "Auth", role: "breaks login and sessions" },
  { id: "exfil", name: "Exfil", role: "extracts the data" },
];

const ROW_COLOR: Record<FeedLine["kind"], string> = {
  attempt: "text-[#9fb0cc]", vuln: "text-gold", win: "text-red", info: "text-mute",
  handoff: "text-text", detect: "text-gold", mitigate: "text-blue", blocked: "text-win", error: "text-red/80", think: "text-mute/80",
};

export default function RedRail({ state, lab, model }: { state: ArenaState; lab?: string; model?: string }) {
  return (
    <div className="card flex flex-col h-full min-h-0 overflow-hidden">
      <div className="panel-head px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red" />
          <span className="font-display font-bold text-[16px] tracking-wide text-text">Red</span>
          <HelpTip title="Red — attacker" tone="#ff3b50" align="start" side="bottom"
            text="The attacking AI and its specialist agents (recon, exploit, auth, exfil). The glowing one is acting now; the console below is its live log." />
        </div>
        {model && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-mute">
            {lab && <LabIcon labId={lab} size={13} />}{model}
          </span>
        )}
      </div>

      <div className="px-3 pt-3 grid gap-2">
        {AGENTS.map((a) => (
          <AgentCard key={a.id} a={a} status={state.agentStatus[a.id]} last={state.agentLast[a.id]} active={state.activeAgent === a.id} />
        ))}
      </div>

      <div className="px-4 pt-4 pb-2 text-[10px] font-bold tracking-[0.12em] uppercase text-faint">Console</div>
      <Feed lines={state.feedRed} />
    </div>
  );
}

function AgentCard({ a, status, last, active }: { a: { name: string; role: string }; status: string; last?: string; active: boolean }) {
  return (
    <div className={`relative overflow-hidden rounded-xl px-3 py-2.5 transition-all duration-300 ${active ? "bg-red/[0.1] ring-1 ring-red/50 sweep" : "bg-white/[0.025] ring-1 ring-white/[0.06]"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${active ? "bg-red animate-pulse" : "bg-mute/50"}`} />
          <span className={`text-[13px] font-bold ${active ? "text-red" : "text-[#c3cde0]"}`}>{a.name}</span>
        </div>
        <span className={`text-[9px] font-bold tracking-[0.1em] uppercase ${active ? "text-red" : "text-faint"}`}>{active ? "Active" : "Idle"}</span>
      </div>
      <div className="text-[11px] text-mute truncate mt-1 font-mono">
        {last ? last : a.role}
      </div>
    </div>
  );
}

function Feed({ lines }: { lines: FeedLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  const shown = lines.slice(-22);
  return (
    <div ref={ref} className="feed flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1 font-mono text-[11px] leading-snug">
      <AnimatePresence initial={false}>
        {shown.map((l) => (
          <motion.div key={l.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
            className="flex gap-1.5">
            <span className={`${ROW_COLOR[l.kind]} whitespace-nowrap font-medium`}>{l.text}</span>
            {l.sub && <span className="text-mute/70 truncate">{l.sub}</span>}
            {l.n && l.n > 1 && <span className="text-mute/60 shrink-0">×{l.n}</span>}
            {l.sev && <span className="ml-auto text-gold/80 uppercase text-[9px]">{l.sev}</span>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
