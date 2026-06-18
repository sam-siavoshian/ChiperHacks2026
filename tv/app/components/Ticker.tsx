"use client";

import type { ArenaState, TickerItem } from "@/lib/arenaState";

const TONE: Record<TickerItem["tone"], string> = {
  red: "text-red", blue: "text-blue", amber: "text-gold", win: "text-win",
};

export default function Ticker({ state }: { state: ArenaState }) {
  const items = state.ticker.length
    ? state.ticker
    : [{ id: "idle", tone: "blue" as const, text: "Cyber Arena — AI red attacker vs AI blue defender, live" }];
  const loop = [...items, ...items];
  return (
    <div className="relative h-9 card rounded-xl overflow-hidden flex items-center">
      <div className="shrink-0 h-full px-4 flex items-center gap-2 bg-red/15 border-r border-white/10">
        <span className="w-2 h-2 rounded-full bg-red animate-pulse" />
        <span className="font-display font-bold text-[12px] tracking-wide text-red">WIRE</span>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div className="flex items-center gap-10 whitespace-nowrap animate-ticker will-change-transform">
          {loop.map((t, i) => (
            <span key={i} className="flex items-center gap-2.5 text-[13px] font-medium">
              <span className={`w-1.5 h-1.5 rounded-full ${t.tone === "red" ? "bg-red" : t.tone === "blue" ? "bg-blue" : t.tone === "win" ? "bg-win" : "bg-gold"}`} />
              <span className={TONE[t.tone]}>{t.text}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
