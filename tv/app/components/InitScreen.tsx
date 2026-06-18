"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LABS, findLab, modelName } from "@/lib/models";
import { MatchConfig, SidePick, DEFAULT_CONFIG, loadConfig, saveConfig } from "@/lib/matchConfig";
import { useVulns } from "@/lib/useVulns";
import LabIcon from "./LabIcon";
import HelpTip from "./HelpTip";
import BrandMark from "./BrandMark";

const TEAM = {
  red: {
    name: "RED", role: "Attacker", color: "#ff3b50", tint: "rgba(255,59,80,0.14)", kit: "⚔",
    help: "An AI that tries to find and exploit security flaws in the target app before the clock runs out. Pick which model plays this side.",
  },
  blue: {
    name: "BLUE", role: "Defender", color: "#2e90ff", tint: "rgba(46,144,255,0.14)", kit: "🛡",
    help: "An AI that watches the traffic and ships live patches to block Red's attacks. Pick which model plays this side.",
  },
};

export default function InitScreen({ onLaunch }: { onLaunch: (cfg: MatchConfig) => void }) {
  const [cfg, setCfg] = useState<MatchConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const vulns = useVulns(false);

  useEffect(() => { setCfg(loadConfig()); setLoaded(true); }, []);
  useEffect(() => { if (loaded) saveConfig(cfg); }, [cfg, loaded]);

  const setSide = (side: "red" | "blue", pick: SidePick) => setCfg((c) => ({ ...c, [side]: pick }));
  const mirror = cfg.red.lab === cfg.blue.lab && cfg.red.model === cfg.blue.model;

  return (
    <main className="relative h-screen w-screen stadium grid-veil overflow-hidden flex flex-col">
      {/* top nav */}
      <header className="flex items-center justify-between px-7 py-4">
        <div className="flex items-center gap-3">
          <BrandMark size={38} />
          <div className="leading-tight">
            <div className="font-display font-bold text-[20px] tracking-wide text-text">CYBER ARENA</div>
            <div className="flex items-center gap-1.5 -mt-0.5">
              <span className="text-[11px] font-semibold tracking-[0.06em] text-mute">Match setup</span>
              <HelpTip title="Cyber Arena" align="start" side="bottom"
                text="Two AI models face off over a deliberately vulnerable app. Red attacks, Blue defends. Pick a model for each side, then launch the match." />
            </div>
          </div>
        </div>
        <TargetChip app={vulns?.app} real={vulns?.counts.real} connected={!!vulns?.connected} />
      </header>

      {/* fight card */}
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_180px_1fr] items-stretch gap-4 px-6 pb-2">
        <TeamCard side="red" pick={cfg.red} onPick={(p) => setSide("red", p)} />
        <CenterColumn rounds={cfg.rounds} onRounds={(r) => setCfg((c) => ({ ...c, rounds: r }))} mirror={mirror} />
        <TeamCard side="blue" pick={cfg.blue} onPick={(p) => setSide("blue", p)} />
      </div>

      {/* launch bar */}
      <footer className="flex items-center justify-between px-7 py-5">
        <div className="flex items-center gap-1.5 text-[13px] text-mute">
          {mirror
            ? <span className="text-gold font-semibold">Same model on both sides</span>
            : <span>Red attacks, Blue defends. Most points wins the match.</span>}
          <HelpTip title="How scoring works" align="start" side="top"
            text="Red earns points for each flaw it exploits. Blue earns points for each flaw it patches before Red gets there. Highest total wins the match." />
        </div>
        <motion.button onClick={() => onLaunch(cfg)} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          className="btn-primary flex items-center gap-2.5 pl-7 pr-6 py-3.5">
          <span className="font-display text-[19px] tracking-wide">LAUNCH MATCH</span>
          <span className="text-[16px]">→</span>
        </motion.button>
      </footer>
    </main>
  );
}

function TeamCard({ side, pick, onPick }: { side: "red" | "blue"; pick: SidePick; onPick: (p: SidePick) => void }) {
  const t = TEAM[side];
  const lab = findLab(pick.lab) ?? LABS[0];
  return (
    <motion.div layout className="relative card overflow-hidden flex flex-col"
      style={{ boxShadow: `0 24px 60px -30px ${t.color}` }}>
      {/* team-colored top wash */}
      <div className="absolute inset-x-0 top-0 h-32 pointer-events-none"
        style={{ background: `linear-gradient(180deg, ${t.tint}, transparent)` }} />
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: t.color }} />

      {/* header */}
      <div className="relative px-6 pt-5 pb-4 flex items-start justify-between">
        <div>
          <div className="font-display font-bold text-[40px] leading-none" style={{ color: t.color }}>{t.name}</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[12px] font-bold tracking-[0.12em] uppercase text-mute">{t.role}</span>
            <HelpTip title={`${t.name} — ${t.role}`} text={t.help} tone={t.color} align="start" side="bottom" />
          </div>
        </div>
        <div className="w-12 h-12 rounded-2xl grid place-items-center text-[22px]"
          style={{ background: t.tint, border: `1px solid ${t.color}55` }}>{t.kit}</div>
      </div>

      {/* selected model hero */}
      <div className="relative mx-6 mb-4 rounded-2xl px-5 py-4"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2 mb-1">
          <LabIcon labId={pick.lab} variant="avatar" size={22} />
          <span className="text-[12px] font-semibold text-mute">{lab.name}</span>
        </div>
        <div className="font-display font-bold text-[28px] leading-tight text-text">{modelName(pick.lab, pick.model)}</div>
      </div>

      {/* lab pills */}
      <div className="relative px-6">
        <Label help="The company that builds the model — Anthropic, OpenAI, Google, and others.">Lab</Label>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {LABS.map((l) => {
            const on = l.id === pick.lab;
            return (
              <button key={l.id} onClick={() => onPick({ lab: l.id, model: l.models[0].id })}
                className="flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-full text-[12px] font-semibold transition-all"
                style={on
                  ? { background: t.color, color: "#fff", boxShadow: `0 6px 18px -8px ${t.color}` }
                  : { background: "rgba(255,255,255,0.05)", color: "#9aa6be", border: "1px solid rgba(255,255,255,0.08)" }}>
                <LabIcon labId={l.id} size={14} color={on ? "#fff" : l.accent} />{l.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* model list */}
      <div className="relative px-6 pt-4 pb-5 flex-1 min-h-0 flex flex-col">
        <Label help="The specific AI model that will play this side. Tags show what each is tuned for.">Model</Label>
        <div className="feed grid gap-2 overflow-y-auto pr-1 mt-2">
          {lab.models.map((m) => {
            const on = m.id === pick.model;
            return (
              <button key={m.id} onClick={() => onPick({ lab: lab.id, model: m.id })}
                className="group flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all"
                style={on
                  ? { background: t.tint, border: `1px solid ${t.color}`, boxShadow: `inset 0 0 0 1px ${t.color}33` }
                  : { background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <span className="w-5 h-5 rounded-full grid place-items-center shrink-0"
                  style={on ? { background: t.color } : { border: "1.5px solid rgba(255,255,255,0.2)" }}>
                  {on && <span className="text-white text-[11px] leading-none">✓</span>}
                </span>
                <span className={`text-[15px] font-bold flex-1 ${on ? "text-text" : "text-[#c3cde0]"}`}>{m.name}</span>
                <span className="text-[10px] font-bold tracking-[0.08em] uppercase px-2 py-1 rounded-md"
                  style={{ background: on ? `${t.color}22` : "rgba(255,255,255,0.05)", color: on ? t.color : "#7a88a6" }}>{m.tag}</span>
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function CenterColumn({ rounds, onRounds, mirror }: { rounds: number; onRounds: (r: number) => void; mirror: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-8">
      <div className="relative">
        <div className="absolute -inset-6 rounded-full blur-2xl opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,59,80,.5), rgba(46,144,255,.5))" }} />
        <div className="relative font-display font-bold text-[64px] leading-none"
          style={{ background: "linear-gradient(180deg,#fff,#9fb0d0)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
          VS
        </div>
      </div>

      <div className="flex flex-col items-center gap-2.5">
        <Label help="How many rounds the match runs. Each round is a fresh attempt on a clean copy of the target.">Format</Label>
        <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {[1, 3, 5].map((r) => (
            <button key={r} onClick={() => onRounds(r)}
              className="w-10 h-9 rounded-full font-display font-bold text-[16px] transition-all"
              style={rounds === r
                ? { background: "#b8ff3b", color: "#0a1206" }
                : { color: "#8a97b4" }}>
              {r}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-semibold text-mute">Best of {rounds}</span>
      </div>
    </div>
  );
}

function Label({ children, help }: { children: React.ReactNode; help?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-faint">{children}</span>
      {help && <HelpTip text={help} align="start" />}
    </div>
  );
}

function TargetChip({ app, real, connected }: { app?: string; real?: number; connected: boolean }) {
  return (
    <div className="glass rounded-2xl flex items-center divide-x divide-white/10">
      <div className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-faint">Target</span>
          <HelpTip title="Target app" align="end" side="bottom"
            text={`${app ?? "Tasklight"} is a deliberately vulnerable demo app. Both models compete over its security flaws.`} />
        </div>
        <div className="text-[14px] font-bold text-text">{app ?? "Tasklight"}</div>
      </div>
      <div className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-faint">Surface</span>
          <HelpTip title="Attack surface" align="end" side="bottom"
            text="The number of real, planted vulnerabilities in the app. Open the dossier during the match to see them all." />
        </div>
        <div className="text-[14px] font-bold text-gold">{real ?? "—"} vulns</div>
      </div>
      <div className="px-4 py-2.5 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-win" : "bg-mute"}`} />
        <span className={`text-[12px] font-semibold ${connected ? "text-win" : "text-mute"}`}>{connected ? "Arena up" : "Arena offline"}</span>
      </div>
    </div>
  );
}
