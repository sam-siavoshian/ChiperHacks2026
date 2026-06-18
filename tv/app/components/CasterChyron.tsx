"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { CasterLine } from "@/lib/arenaState";
import HelpTip from "./HelpTip";

export default function CasterChyron({ caster, now }: { caster: CasterLine | null; now: number }) {
  const elapsed = caster ? now - caster.startedAt : 0;
  const lastT = caster?.words.length ? caster.words[caster.words.length - 1].t : 0;
  const speaking = !!caster && elapsed < lastT + 1400;
  const intensity = caster?.intensity ?? "normal";
  const accent = intensity === "hype" ? "#ff3b50" : intensity === "calm" ? "#2e90ff" : "#b8ff3b";

  return (
    <div className="pointer-events-none absolute left-0 right-0 bottom-0 z-30 px-3 pb-3">
      <div className="relative glass rounded-2xl overflow-hidden flex items-stretch shadow-card">
        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />

        {/* caster ident */}
        <div className="flex items-center gap-3 pl-5 pr-4 py-3 border-r border-white/10 min-w-[200px]">
          <div className="relative w-11 h-11 rounded-xl grid place-items-center text-[20px]"
            style={{ background: `${accent}1f`, border: `1px solid ${accent}55` }}>
            {speaking && <span className="absolute inset-0 rounded-xl animate-ping" style={{ background: `${accent}18` }} />}
            <span className="relative">🎙</span>
          </div>
          <div className="pointer-events-auto">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-faint">Commentary</span>
              <HelpTip text="AI play-by-play. It narrates the match as it happens, and reads out loud when the voice is on." align="start" />
            </div>
            <div className="font-display font-bold text-[18px] leading-tight" style={{ color: accent }}>
              {caster?.caster ?? "The Analyst"}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${speaking ? "bg-red animate-pulse" : "bg-mute"}`} />
              <span className="text-[10px] font-semibold text-mute">{speaking ? "On air" : "Standby"}</span>
            </div>
          </div>
        </div>

        {/* caption */}
        <div className="flex-1 flex items-center px-6 py-3 min-h-[74px]">
          <AnimatePresence mode="wait">
            <motion.p key={caster?.id ?? "idle"}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}
              className="font-ui font-semibold text-[22px] leading-snug text-text">
              {caster
                ? caster.words.map((wd, i) => {
                    const on = elapsed >= wd.t;
                    const fresh = on && elapsed < wd.t + 220;
                    return (
                      <span key={i} style={{ opacity: on ? 1 : 0.22, color: fresh ? accent : undefined, transition: "opacity .12s, color .2s" }}>
                        {wd.w}{" "}
                      </span>
                    );
                  })
                : <span className="text-mute font-medium">Waiting for the match to start…</span>}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* waveform */}
        <div className="flex items-center px-5 border-l border-white/10">
          <Waveform speaking={speaking} accent={accent} now={now} />
        </div>
      </div>
    </div>
  );
}

function Waveform({ speaking, accent, now }: { speaking: boolean; accent: string; now: number }) {
  const bars = 12;
  return (
    <div className="flex items-center gap-[3px] h-9">
      {Array.from({ length: bars }).map((_, i) => {
        const h = speaking
          ? 6 + Math.abs(Math.sin(now / 90 + i * 0.7)) * 24 * (0.5 + Math.abs(Math.sin(i * 1.3)) * 0.5)
          : 4;
        return <span key={i} className="w-[3px] rounded-full" style={{ height: h, background: accent, opacity: speaking ? 0.9 : 0.25 }} />;
      })}
    </div>
  );
}
