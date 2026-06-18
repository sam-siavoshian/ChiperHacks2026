"use client";

import AnimatedNumber from "./AnimatedNumber";
import BrandMark from "./BrandMark";
import HelpTip from "./HelpTip";
import type { ArenaState } from "@/lib/arenaState";
import type { ConnStatus } from "@/lib/useBroadcast";

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.max(0, s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

export default function BroadcastBar({ state, status }: { state: ArenaState; status: ConnStatus }) {
  const low = state.secondsLeft <= 6 && state.secondsLeft > 0 && state.phase === "round";
  return (
    <div className="relative h-16 flex items-center justify-between px-4 select-none">
      {/* brand */}
      <div className="flex items-center gap-2.5 w-[230px]">
        <BrandMark size={32} />
        <span className="font-display font-bold text-[17px] tracking-wide text-text">CYBER ARENA</span>
        <HelpTip title="The scoreboard" align="start" side="bottom"
          text="Red scores by exploiting a flaw; Blue scores by patching one first. The clock counts down the round. Most points wins." />
      </div>

      {/* center scorebug */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-stretch glass rounded-2xl overflow-hidden shadow-card">
        <TeamBlock side="red" score={state.redScore} />
        <div className="px-6 flex flex-col items-center justify-center bg-white/[0.02]">
          <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-mute">
            {state.phase === "final" ? "Final" : `Round ${Math.max(1, state.round)}/3`}
          </div>
          <div className={`font-display font-bold text-[28px] leading-none tabular ${low ? "text-red" : "text-text"}`}>
            {fmt(state.secondsLeft)}
          </div>
        </div>
        <TeamBlock side="blue" score={state.blueScore} />
      </div>

      {/* live status */}
      <div className="w-[230px] flex justify-end items-center gap-1.5">
        <LiveBadge status={status} />
        <HelpTip title="Live, on a delay" align="end" side="bottom"
          text="The feed runs about 15 seconds behind the real match so the AI commentary and voice can stay in sync, like live TV." />
      </div>
    </div>
  );
}

function TeamBlock({ side, score }: { side: "red" | "blue"; score: number }) {
  const color = side === "red" ? "#ff3b50" : "#2e90ff";
  const label = side === "red" ? "RED" : "BLUE";
  return (
    <div className={`flex items-center gap-3 px-5 py-2 ${side === "blue" ? "flex-row-reverse" : ""}`}
      style={{ background: `linear-gradient(${side === "red" ? "90deg" : "270deg"}, ${color}22, transparent)` }}>
      <div className="w-1 self-stretch rounded-full" style={{ background: color }} />
      <div className={side === "blue" ? "text-right" : ""}>
        <div className="text-[11px] font-bold tracking-[0.12em]" style={{ color }}>{label}</div>
        <AnimatedNumber value={score} className="font-display font-bold text-[30px] leading-none text-text" />
      </div>
    </div>
  );
}

function LiveBadge({ status }: { status: ConnStatus }) {
  if (status === "live") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red/15 border border-red/30">
        <span className="w-2 h-2 rounded-full bg-red animate-pulse" />
        <span className="font-display font-bold text-[13px] tracking-wide text-red">LIVE</span>
      </div>
    );
  }
  const amber = status === "connecting";
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
      <span className={`w-2 h-2 rounded-full ${amber ? "bg-gold animate-pulse" : "bg-mute"}`} />
      <span className={`font-display font-bold text-[13px] tracking-wide ${amber ? "text-gold" : "text-mute"}`}>
        {amber ? "SYNCING" : "OFFLINE"}
      </span>
    </div>
  );
}
