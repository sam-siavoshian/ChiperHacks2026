"use client";

import type { BudgetHUD } from "@/lib/arenaState";

// Live "tool calls left this turn" HUD. Sits in a side's console chrome and
// shows three things the moment a model acts: how many tool calls it gets this
// turn, the tool it just called, and how many calls remain. Purely derived from
// the BudgetHUD snapshot folded out of `attempting` events — re-renders live.
export default function ToolBudget({ hud, tone, now }: { hud: BudgetHUD | null; tone: string; now: number }) {
  const has = !!hud && hud.budget > 0;
  const budget = has ? hud!.budget : 0;
  const remaining = has ? hud!.remaining : 0;
  const tool = hud?.tool || null;
  // glow the bar + number briefly each time this side acts (drives the "live" feel)
  const fresh = hud ? now - hud.at < 1400 : false;
  const cells = Math.min(budget, 12); // fixed budget is small; guard just in case
  const low = has && remaining <= 1;

  return (
    <div className="flex items-center gap-2.5">
      {/* current tool chip — what they just called */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md max-w-[140px]"
        style={{ background: `${tone}14`, border: `1px solid ${tone}33` }}>
        <span className="text-[10px]" style={{ color: tone }}>⚙</span>
        <span className="font-mono text-[11px] font-semibold truncate" style={{ color: tone }}>
          {tool || "idle"}
        </span>
      </div>

      {/* segmented budget bar — filled cells = calls left */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-[3px]">
          {Array.from({ length: cells }).map((_, i) => {
            const on = i < remaining;
            return (
              <span key={i} className="w-[5px] h-4 rounded-[2px] transition-all duration-300"
                style={{
                  background: on ? tone : "rgba(255,255,255,0.10)",
                  boxShadow: on && fresh ? `0 0 7px ${tone}` : "none",
                  opacity: on ? 1 : 0.7,
                }} />
            );
          })}
        </div>
        <div className="flex flex-col items-end leading-none">
          <span className="font-mono text-[12px] font-bold tabular slam-in"
            key={`${remaining}-${budget}`}
            style={{ color: low ? "#ff8b3b" : tone }}>
            {has ? remaining : "—"}<span className="text-faint">/{has ? budget : "—"}</span>
          </span>
          <span className="text-[8px] font-bold tracking-[0.12em] text-faint mt-0.5">TOOLS LEFT</span>
        </div>
      </div>
    </div>
  );
}
