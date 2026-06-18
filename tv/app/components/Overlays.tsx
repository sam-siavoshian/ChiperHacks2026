"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ArenaState } from "@/lib/arenaState";
import type { ConnStatus } from "@/lib/useBroadcast";

const BREACH_MS = 2900;
const PROOF_MS = 2300;
const INTRO_MS = 2600;
const RESULT_MS = 4400;

export default function Overlays({ state, now, status }: { state: ArenaState; now: number; status: ConnStatus }) {
  // Standby is a blocking pre-match card. Let the operator dismiss it to peek at
  // the empty dashboard while no match is feeding; it re-arms on the next lobby.
  const [skipStandby, setSkipStandby] = useState(false);
  useEffect(() => {
    if (state.phase !== "lobby" && skipStandby) setSkipStandby(false);
  }, [state.phase, skipStandby]);

  // Strict precedence so only ONE full-screen overlay shows at a time:
  // breach > proof > result > intro. Without this a breach landing inside the
  // intro window stacks two cards on top of each other.
  const breachOn = state.breach && now - state.breach.at < BREACH_MS;
  const proofOn = !breachOn && state.proof && now - state.proof.at < PROOF_MS;
  const resultOn = !breachOn && !proofOn && state.roundResult && now - state.resultAt < (state.phase === "final" ? 1e9 : RESULT_MS);
  const introOn = !breachOn && !proofOn && !resultOn && state.phase === "round" && state.roundAt > 0 && now - state.roundAt < INTRO_MS;
  const standbyOn = state.phase === "lobby" && !skipStandby;

  return (
    <>
      <AnimatePresence>{standbyOn && <Standby key="standby" status={status} onDismiss={() => setSkipStandby(true)} />}</AnimatePresence>
      <AnimatePresence>{introOn && <RoundIntro key="intro" round={state.round} title={state.roundTitle} cls={state.vulnClass} />}</AnimatePresence>
      <AnimatePresence>{proofOn && <ProofFlash key={state.proof!.id} url={state.proof!.url} />}</AnimatePresence>
      <AnimatePresence>{breachOn && <BreachBeat key={state.breach!.id} trophy={state.breach!.trophy} host={state.breach!.host} cls={state.breach!.cls} />}</AnimatePresence>
      <AnimatePresence>{resultOn && <ResultCard key="result" state={state} />}</AnimatePresence>
    </>
  );
}

/* ---- STANDBY (no match streaming yet) ------------------------------------- */
function Standby({ status, onDismiss }: { status: ConnStatus; onDismiss: () => void }) {
  const msg = status === "live" ? "Connected. Waiting for the match to begin."
    : status === "connecting" ? "Connecting to the match feed…"
    : "No feed yet. Waiting for the match to start.";

  // Esc or Enter dismisses too, so a keyboard-only operator is never trapped.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <motion.div className="absolute inset-0 z-40 grid place-items-center cursor-pointer"
      onClick={onDismiss} role="button" tabIndex={0} aria-label="Dismiss standby and preview dashboard"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-ink/55 backdrop-blur-[1px]" />
      <div className="relative text-center">
        <div className="font-hud font-bold text-[16px] tracking-[0.5em] text-mute mb-4">CYBER&nbsp;ARENA</div>
        <div className="flex items-center justify-center gap-3 mb-5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber animate-pulse" />
          <span className="font-hud font-bold text-[34px] leading-none text-[#cfdcf2] tracking-[0.04em]">STANDBY</span>
          <span className="w-2.5 h-2.5 rounded-full bg-amber animate-pulse" />
        </div>
        <div className="text-[13px] font-medium text-mute">{msg}</div>
        <div className="mt-6 mx-auto h-[2px] w-48 overflow-hidden bg-white/10 relative rounded-full">
          <span className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-blue to-transparent animate-sweep" />
        </div>
        <div className="mt-7 text-[12px] text-mute/60">Click anywhere to preview the dashboard</div>
      </div>
    </motion.div>
  );
}

/* ---- ROUND INTRO ---------------------------------------------------------- */
function RoundIntro({ round, title, cls }: { round: number; title: string; cls: string }) {
  return (
    <motion.div className="absolute inset-0 z-40 grid place-items-center pointer-events-none"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-ink/70 backdrop-blur-[2px]" />
      <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }} transition={{ type: "spring", stiffness: 140, damping: 18 }}
        className="relative text-center">
        <div className="font-mono text-[11px] tracking-[0.5em] text-amber mb-3">ROUND&nbsp;{round}&nbsp;/&nbsp;3</div>
        <div className="font-hud font-bold text-[58px] leading-none text-[#eef4ff] tracking-[0.02em]">{title.toUpperCase()}</div>
        <div className="mt-4 inline-block px-4 py-1 border border-edge2 bg-black/40 font-mono text-[11px] tracking-[0.3em] text-mute">CLASS&nbsp;//&nbsp;{cls.toUpperCase()}</div>
        <div className="mt-5 mx-auto h-[2px] w-40 bg-gradient-to-r from-transparent via-red to-transparent" />
      </motion.div>
    </motion.div>
  );
}

/* ---- BREACH BEAT ---------------------------------------------------------- */
function BreachBeat({ trophy, host, cls }: { trophy: string; host: string; cls: string }) {
  return (
    <motion.div className="absolute inset-0 z-50 grid place-items-center overflow-hidden pointer-events-none"
      initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
      {/* brief red flash to mark the breach */}
      <motion.div className="absolute inset-0 bg-red" initial={{ opacity: 0.7 }} animate={{ opacity: 0 }} transition={{ duration: 0.5 }} />
      <div className="absolute inset-0 bg-ink/55" />

      <motion.div className="relative text-center"
        initial={{ scale: 1.1, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 16 }}>
        <div className="font-mono text-[12px] tracking-[0.5em] text-red mb-2">// {cls.toUpperCase()} //</div>
        <RootSlam text="ROOT ACCESS" />
        <div className="mt-3 font-hud font-bold text-[22px] tracking-[0.1em] text-[#ffd0d6]">{trophy.toUpperCase()}</div>
        <div className="mt-1 font-mono text-[12px] tracking-[0.2em] text-red/80">TARGET&nbsp;//&nbsp;{host}</div>
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 border border-red/50 bg-red/10">
          <span className="w-2 h-2 rounded-full bg-red animate-pulse" />
          <span className="font-hud font-bold text-[14px] tracking-[0.2em] text-red">RED&nbsp;+3</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

// slam title via a single clip-path reveal
function RootSlam({ text }: { text: string }) {
  return (
    <motion.div className="font-hud font-bold text-[84px] leading-none text-red"
      initial={{ clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: "inset(0 0% 0 0)" }} transition={{ duration: 0.32, ease: [0.2, 0.7, 0.2, 1] }}>
      {text}
    </motion.div>
  );
}

/* ---- BLOCKED BY BLUE proof ------------------------------------------------ */
function ProofFlash({ url }: { url: string }) {
  return (
    <motion.div className="absolute inset-0 z-50 grid place-items-center pointer-events-none"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="absolute inset-0 bg-blue" initial={{ opacity: 0.4 }} animate={{ opacity: 0 }} transition={{ duration: 0.45 }} />
      <div className="absolute inset-0 bg-ink/50" />
      <motion.div className="relative text-center"
        initial={{ scale: 1.25, opacity: 0, rotate: -2 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 240, damping: 15 }}>
        <div className="font-mono text-[12px] tracking-[0.45em] text-blue mb-1">SAME&nbsp;PAYLOAD&nbsp;//&nbsp;RE-FIRED</div>
        <div className="font-hud font-bold text-[88px] leading-none text-blue">403</div>
        <div className="font-hud font-bold text-[28px] tracking-[0.12em] text-[#cfe6ff] mt-1">BLOCKED&nbsp;BY&nbsp;BLUE</div>
        <div className="mt-2 font-mono text-[11px] text-blue/70 truncate max-w-[460px] mx-auto">{url}</div>
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 border border-blue/50 bg-blue/10">
          <span className="font-hud font-bold text-[14px] tracking-[0.2em] text-blue">PATCH&nbsp;HELD</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---- ROUND / FINAL RESULT ------------------------------------------------- */
function ResultCard({ state }: { state: ArenaState }) {
  const final = state.phase === "final";
  const r = state.roundResult!;
  const wColor = r.winner === "red" ? "#ff2740" : "#27a3ff";
  const matchWinner = state.redScore === state.blueScore ? "draw" : state.redScore > state.blueScore ? "red" : "blue";
  const mColor = matchWinner === "red" ? "#ff2740" : matchWinner === "blue" ? "#27a3ff" : "#cbd8ef";
  return (
    <motion.div className="absolute inset-0 z-40 grid place-items-center pointer-events-none"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-ink/80 backdrop-blur-[3px]" />
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={{ type: "spring", stiffness: 150, damping: 18 }}
        className="relative panel px-12 py-8 text-center min-w-[440px]">
        {final ? (
          <>
            <div className="font-mono text-[11px] tracking-[0.5em] text-mute mb-2">MATCH&nbsp;COMPLETE</div>
            <div className="font-hud font-bold text-[52px] leading-none mb-1" style={{ color: mColor, textShadow: `0 0 18px ${mColor}88` }}>
              {matchWinner === "draw" ? "DRAW" : `${matchWinner.toUpperCase()} WINS`}
            </div>
            <div className="flex items-center justify-center gap-8 my-5">
              <Tally label="RED · SWARM" score={state.redScore} color="#ff2740" />
              <span className="font-hud text-mute text-2xl">vs</span>
              <Tally label="BLUE · DEFENDER" score={state.blueScore} color="#27a3ff" />
            </div>
            <div className="font-mono text-[11px] text-mute max-w-[420px]">{r.summary}</div>
            <div className="mt-4 font-mono text-[9px] tracking-[0.3em] text-mute/60 animate-pulse">REPLAY&nbsp;LOOPS&nbsp;SHORTLY</div>
          </>
        ) : (
          <>
            <div className="font-mono text-[11px] tracking-[0.5em] text-mute mb-2">ROUND&nbsp;{r.round}&nbsp;RESULT</div>
            <div className="font-hud font-bold text-[44px] leading-none" style={{ color: wColor, textShadow: `0 0 16px ${wColor}88` }}>
              {r.winner.toUpperCase()}&nbsp;TAKES&nbsp;IT
            </div>
            <div className="mt-4 font-mono text-[12px] text-[#aabfe0] max-w-[400px] leading-relaxed">{r.summary}</div>
            <div className="mt-5 font-mono text-[10px] tracking-[0.3em] text-mute">RED&nbsp;{state.redScore}&nbsp;&nbsp;·&nbsp;&nbsp;BLUE&nbsp;{state.blueScore}</div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function Tally({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div>
      <div className="font-hud text-[10px] tracking-[0.16em] text-mute mb-1">{label}</div>
      <div className="font-hud font-bold text-[56px] leading-none tabular" style={{ color, textShadow: `0 0 16px ${color}88` }}>{score}</div>
    </div>
  );
}
