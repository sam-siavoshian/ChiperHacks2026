"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import CasterChyron from "./CasterChyron";
import AttackerView from "./AttackerView";
import DefenderView from "./DefenderView";
import HelpTip from "./HelpTip";
import type { ArenaState, ExfilItem } from "@/lib/arenaState";

// AttackGraph touches window (canvas/force sim), so it stays client-only.
const AttackGraph = dynamic(() => import("./AttackGraph"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-[12px] font-medium text-mute">Initializing topology…</div>,
});

type Tab = "attacker" | "defender" | "network";
type Mode = "auto" | Tab;

export default function MainStage({ state, now }: { state: ArenaState; now: number }) {
  // The TV auto-directs: it cuts to whoever moved most recently, like a live
  // sports feed. The operator can pin a view by clicking a tab; "AUTO" resumes
  // hands-off direction.
  const [mode, setMode] = useState<Mode>("auto");

  const autoTab: Tab = useMemo(() => {
    const a = state.attacker?.at ?? -1;
    const d = state.defender?.at ?? -1;
    if (a < 0 && d < 0) return "attacker";
    return d > a ? "defender" : "attacker";
  }, [state.attacker?.at, state.defender?.at]);

  const tab: Tab = mode === "auto" ? autoTab : mode;
  const isAuto = mode === "auto";
  const fresh = (at?: number) => at != null && now - at < 2600;
  const liveSide: "red" | "blue" | null = tab === "attacker" && fresh(state.attacker?.at) ? "red" : tab === "defender" && fresh(state.defender?.at) ? "blue" : null;

  return (
    <div className="relative card overflow-hidden min-h-0 grid-veil">
      {/* NOW ON bug — which corner the broadcast is cut to right now */}
      <div className="absolute z-30 top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-full glass">
        <span className="text-[9px] font-bold tracking-[0.14em] text-faint">{isAuto ? "AUTO" : "PINNED"}</span>
        <span className="w-px h-3 bg-white/15" />
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: tab === "attacker" ? "#ff3b50" : tab === "defender" ? "#2e90ff" : "#b8ff3b", animation: liveSide ? "blink 1.05s step-end infinite" : "none" }} />
        <span className="text-[11px] font-bold" style={{ color: tab === "attacker" ? "#ff3b50" : tab === "defender" ? "#2e90ff" : "#b8ff3b" }}>
          {tab === "attacker" ? "NOW ON · RED" : tab === "defender" ? "NOW ON · BLUE" : "NETWORK MAP"}
        </span>
      </div>

      {/* tab switcher */}
      <div className="absolute z-30 top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 rounded-full glass">
        <AutoBtn on={isAuto} onClick={() => setMode("auto")} />
        <span className="w-px h-4 bg-white/12 mx-0.5" />
        <TabBtn on={!isAuto && tab === "attacker"} live={tab === "attacker"} onClick={() => setMode("attacker")} label="Attacker" dot="#ff3b50" />
        <TabBtn on={!isAuto && tab === "defender"} live={tab === "defender"} onClick={() => setMode("defender")} label="Defender" dot="#2e90ff" />
        <TabBtn on={!isAuto && tab === "network"} live={tab === "network"} onClick={() => setMode("network")} label="Network" dot="#b8ff3b" />
        <HelpTip align="end" side="bottom" className="mr-1"
          text="AUTO cuts to whoever just moved — Red attacking or Blue defending. Click a tab to pin a view; AUTO resumes hands-off." />
      </div>

      {tab === "attacker" && <AttackerView attacker={state.attacker} budget={state.redBudget} now={now} />}
      {tab === "defender" && <DefenderView defender={state.defender} rulesCount={state.rules.length} budget={state.blueBudget} now={now} />}
      {tab === "network" && (
        <>
          <AttackGraph nodes={state.nodes} links={state.links} />
          <CornerTag className="top-3 right-3 text-right items-end" label={state.vulnClass ? state.vulnClass : "Standby"} sub="Active vector" tone="red" align="right"
            help="The type of attack Red is running right now." />
        </>
      )}

      <ExfilMonitor exfil={state.exfil} />
      <CasterChyron caster={state.caster} now={now} />
    </div>
  );
}

function AutoBtn({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all ${on ? "bg-win/15 text-win" : "text-mute hover:text-[#c3cde0]"}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: on ? "#b8ff3b" : "#5a6684", animation: on ? "blink 1.05s step-end infinite" : "none" }} />
      AUTO
    </button>
  );
}

function TabBtn({ on, live, onClick, label, dot }: { on: boolean; live: boolean; onClick: () => void; label: string; dot: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all ${on ? "bg-white/10 text-text" : "text-mute hover:text-[#c3cde0]"}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: on || live ? dot : "#5a6684" }} />
      {label}
    </button>
  );
}

function CornerTag({ className, label, sub, tone, dot, align, help }: { className: string; label: string; sub: string; tone: "red" | "blue"; dot?: boolean; align?: "right"; help?: string }) {
  const c = tone === "red" ? "text-red" : "text-blue";
  return (
    <div className={`absolute z-20 flex flex-col gap-0.5 ${className}`}>
      <div className={`flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {dot && <span className={`w-2 h-2 rounded-full ${tone === "red" ? "bg-red" : "bg-blue"} animate-pulse`} />}
        <span className={`font-display font-bold text-[14px] tracking-wide ${c}`}>{label}</span>
        {help && <HelpTip text={help} tone={tone === "red" ? "#ff3b50" : "#2e90ff"} align={align === "right" ? "end" : "start"} side="bottom" />}
      </div>
      <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-faint">{sub}</span>
    </div>
  );
}

function ExfilMonitor({ exfil }: { exfil: ExfilItem[] }) {
  const latest = exfil[exfil.length - 1];
  if (!latest) return null;
  return (
    <div className="absolute z-20 bottom-[104px] right-3 w-[236px] glass rounded-xl overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/10">
        <span className="text-[11px] font-bold text-red">⬇ Data exfil</span>
        <span className="text-[11px] font-mono text-mute">{(latest.bytes / 1024).toFixed(1)} kb</span>
      </div>
      <div className="px-3 py-2">
        <div className="text-[12px] font-semibold text-gold truncate">{latest.filename}</div>
        <div className="font-mono text-[10px] text-win/80 break-all leading-snug mt-1 h-7 overflow-hidden">
          {latest.snippet}
        </div>
      </div>
    </div>
  );
}
