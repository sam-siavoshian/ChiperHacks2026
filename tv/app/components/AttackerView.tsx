"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AttackerView as AV, BudgetHUD } from "@/lib/arenaState";
import ToolBudget from "./ToolBudget";

// Where the target app lives. The iframe is a READ-ONLY backdrop — the audience
// sees the real product behind the attack HUD, but cannot touch it (pointer
// events off, no form submission, a transparent shield on top). It mounts once
// at the origin and never reloads, so there is zero flicker; the live endpoint
// being hit is shown in the HUD, not by navigating the frame.
const ORIGIN = process.env.NEXT_PUBLIC_TARGET_ORIGIN || "http://localhost:4000";
const HOST = ORIGIN.replace(/^https?:\/\//, "");

const PHASE: Record<AV["phase"], { label: string; color: string }> = {
  probing: { label: "PROBING", color: "#ffcf4a" },
  found: { label: "VULN FOUND", color: "#ff8b3b" },
  breached: { label: "BREACHED", color: "#ff3b50" },
  blocked: { label: "BLOCKED BY BLUE", color: "#2e90ff" },
};

const AGENT_NAME: Record<string, string> = {
  recon: "Recon", web_exploit: "Web Exploit", auth: "Auth", exfil: "Exfil",
  orchestrator: "Orchestrator", system: "System",
};

interface WireLine { id: string; at: number; kind: "req" | "res"; text: string; color: string; }
const CHAR_MS = 8; // typewriter speed for the newest line

function methodFor(tool: string): string {
  const t = tool.toLowerCase();
  if (/login|signup|upload|patch|claim|forge|redeem|upgrade|post|create|comment|invite/.test(t)) return "POST";
  return "GET";
}

// Build the request (and, when we have a result, response) lines for one move.
function linesFor(a: AV): WireLine[] {
  const ph = PHASE[a.phase];
  const path = a.path || "/";
  const method = methodFor(a.tool);
  const out: WireLine[] = [
    { id: `${a.at}-req`, at: a.at, kind: "req", text: `${method} ${path}  ·  ${a.tool}${a.note ? `  ⟶ ${a.note}` : ""}`, color: "#cdd9ef" },
  ];
  if (a.status != null) {
    const color = a.phase === "blocked" ? "#2e90ff" : a.phase === "breached" ? "#ff3b50" : a.status >= 400 ? "#ff8b3b" : "#36e0a0";
    out.push({ id: `${a.at}-res`, at: a.at + 60, kind: "res", text: `← HTTP ${a.status}${a.evidence ? `  ${a.evidence}` : ""}`, color });
  }
  // keep phase color available for the chips elsewhere
  void ph;
  return out;
}

export default function AttackerView({ attacker, budget, now }: { attacker: AV | null; budget: BudgetHUD | null; now: number }) {
  const ph = attacker ? PHASE[attacker.phase] : null;
  const agent = attacker ? AGENT_NAME[attacker.agent] || attacker.agent : null;
  const accent = ph?.color || "#ff3b50";
  const path = attacker?.path || "";

  // rolling local wire log built from each new attacker snapshot (state only
  // keeps the latest; we accumulate the recent history here for the terminal).
  const [lines, setLines] = useState<WireLine[]>([]);
  const lastAt = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (attacker && attacker.at !== lastAt.current) {
      lastAt.current = attacker.at;
      setLines((prev) => [...prev, ...linesFor(attacker)].slice(-50));
    }
  }, [attacker?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { feedRef.current?.scrollTo({ top: 1e7 }); }, [lines.length]);

  // always-moving meters (derived from the rAF clock; never sit still). Guard the
  // clock: before the first frame `now` can be NaN, which would render "NaN REQ/S".
  const clk = Number.isFinite(now) ? now : 0;
  const active = attacker ? clk - attacker.at < 2600 : false;
  const rps = Math.max(0, 5 + Math.round(3 * Math.sin(clk / 420)) + (active ? 9 : 0));
  const lat = 34 + Math.round(15 * Math.sin(clk / 260 + 1));

  return (
    <div className="absolute inset-0 flex flex-col p-3 pb-[104px]">
      <div className="flex-1 min-h-0 card overflow-hidden flex flex-col">
        {/* browser chrome + live meters */}
        <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-red/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-gold/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-win/70" />
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/10">
            <span className="text-[11px] text-mute shrink-0">🔒</span>
            <span className="font-mono text-[12px] text-mute shrink-0">{HOST}</span>
            <AnimatePresence mode="wait">
              <motion.span key={path || "root"} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
                className="font-mono text-[12px] truncate" style={{ color: accent }}>{path || "/"}</motion.span>
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ToolBudget hud={budget} tone="#ff3b50" now={now} />
            <span className="w-px h-6 bg-white/10" />
            <Meter label="REQ/S" value={String(rps).padStart(2, "0")} tone="#ff8b3b" />
            <Meter label="LATENCY" value={`${lat}ms`} tone="#36e0a0" />
            {agent && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red/12">
                <span className="w-1.5 h-1.5 rounded-full bg-red animate-pulse" />
                <span className="text-[11px] font-bold text-red">RED · {agent}</span>
              </span>
            )}
            {ph && <span className="text-[11px] font-bold px-2 py-1 rounded-md slam-in" key={ph.label} style={{ background: `${ph.color}22`, color: ph.color }}>{ph.label}</span>}
          </div>
        </div>

        {/* live preview (read-only) + attack overlay */}
        <div className="relative flex-1 min-h-0 bg-ink2 overflow-hidden">
          {/* the real product, locked: no pointer events, no forms, mounts once */}
          <iframe
            src={ORIGIN}
            title="Target — live preview (read-only)"
            tabIndex={-1}
            aria-hidden
            className="absolute inset-0 w-full h-full bg-white pointer-events-none select-none"
            style={{ opacity: 0.5, filter: "saturate(0.9) contrast(1.02)" }}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
          />
          {/* shield: guarantees the audience can never interact with the target */}
          <div className="absolute inset-0 z-10" aria-hidden style={{ background: "linear-gradient(180deg, rgba(7,10,18,0.30), rgba(7,10,18,0.55))" }} />
          {/* drifting scan bar — "we are watching the wire" */}
          <div className="scanbar z-10" />

          {/* targeting reticle locked on the endpoint */}
          <div className="absolute z-20 inset-0 grid place-items-center pointer-events-none">
            <div className="relative w-[210px] h-[210px] grid place-items-center">
              <div className="absolute inset-0 radar-sweep opacity-70" />
              <div className="absolute rounded-full border ping-ring" style={{ width: 120, height: 120, borderColor: `${accent}66` }} />
              <div className="absolute rounded-full border" style={{ width: 150, height: 150, borderColor: `${accent}33` }} />
              {/* crosshair */}
              <div className="absolute w-[210px] h-px" style={{ background: `${accent}30` }} />
              <div className="absolute h-[210px] w-px" style={{ background: `${accent}30` }} />
              <div className="relative z-10 px-3 py-1.5 rounded-md glass text-center max-w-[180px]">
                <div className="text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: accent }}>{attacker ? "TARGET LOCKED" : "ACQUIRING TARGET"}</div>
                <div className="font-mono text-[11px] text-text truncate mt-0.5">{path || HOST}</div>
              </div>
            </div>
          </div>

          {/* packet wire: RED → endpoint, perpetually firing */}
          <div className="absolute z-20 left-4 right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none" style={{ color: `${accent}aa` }}>
            <span className="text-[10px] font-bold tracking-wider shrink-0" style={{ color: accent }}>RED</span>
            <div className="relative flex-1 h-[2px]">
              <div className="flow-wire w-full h-full" style={{ color: `${accent}55` }} />
              {[0, 1, 2].map((i) => (
                <span key={i} className="packet-fly absolute top-1/2 -translate-y-1/2 left-0 w-2 h-2 rounded-full"
                  style={{ background: accent, boxShadow: `0 0 8px ${accent}`, ["--fly" as any]: "calc(100% - 8px)", ["--dur" as any]: "1.5s", ["--delay" as any]: `${i * 0.5}s` }} />
              ))}
            </div>
            <span className="text-[10px] font-bold tracking-wider shrink-0 text-mute">SRV</span>
          </div>

          {/* status slam on a real result */}
          {attacker?.status != null && (
            <div className="absolute z-20 top-3 right-3 slam-in" key={`${attacker.at}-${attacker.status}`}>
              <div className="font-display font-bold text-[44px] leading-none tabular" style={{ color: accent, textShadow: `0 0 24px ${accent}66` }}>{attacker.status}</div>
            </div>
          )}
          <CornerLabel className="bottom-2 left-3" text="LIVE · READ-ONLY" tone={accent} />
        </div>

        {/* live wire terminal — the actual request/response stream, typed out */}
        <div ref={feedRef} className="shrink-0 h-[132px] overflow-y-auto feed bg-black/45 border-t border-white/10 px-4 py-2.5 font-mono text-[12px] leading-[1.55]">
          {lines.length === 0 ? (
            <div className="text-faint">$ awaiting first request from Red<span className="cursor-blink" /></div>
          ) : (
            lines.map((l, i) => {
              const isLast = i === lines.length - 1;
              const shown = isLast ? l.text.slice(0, Math.max(0, Math.floor((now - l.at) / CHAR_MS))) : l.text;
              const done = !isLast || shown.length >= l.text.length;
              return (
                <div key={l.id} className="truncate" style={{ color: l.color }}>
                  <span className="text-faint mr-1.5">{l.kind === "req" ? "›" : "‹"}</span>
                  {shown}
                  {isLast && !done && <span className="cursor-blink" />}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Meter({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex flex-col items-end leading-none">
      <span className="font-mono text-[12px] font-bold tabular" style={{ color: tone }}>{value}</span>
      <span className="text-[8px] font-bold tracking-[0.12em] text-faint mt-0.5">{label}</span>
    </div>
  );
}

function CornerLabel({ className, text, tone }: { className: string; text: string; tone: string }) {
  return (
    <div className={`absolute z-20 flex items-center gap-1.5 px-2 py-1 rounded-md glass ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: tone }} />
      <span className="text-[9px] font-bold tracking-[0.12em]" style={{ color: tone }}>{text}</span>
    </div>
  );
}
