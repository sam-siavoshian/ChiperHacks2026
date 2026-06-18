"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { AttackerView as AV } from "@/lib/arenaState";

// Where the target app lives (what the attacker is hitting). The iframe shows the
// real endpoint response — page or JSON — so the audience sees what Red sees.
const ORIGIN = process.env.NEXT_PUBLIC_TARGET_ORIGIN || "http://localhost:4000";

const PHASE: Record<AV["phase"], { label: string; color: string }> = {
  probing: { label: "Probing", color: "#ffcf4a" },
  found: { label: "Vuln found", color: "#ff8b3b" },
  breached: { label: "Breached", color: "#ff3b50" },
  blocked: { label: "Blocked by Blue", color: "#2e90ff" },
};

const AGENT_NAME: Record<string, string> = {
  recon: "Recon", web_exploit: "Web Exploit", auth: "Auth", exfil: "Exfil",
  orchestrator: "Orchestrator", system: "System",
};

function srcFor(path: string): string {
  if (!path) return ORIGIN;
  if (path.startsWith("http")) return path;
  return ORIGIN + (path.startsWith("/") ? path : "/" + path);
}

export default function AttackerView({ attacker }: { attacker: AV | null }) {
  const path = attacker?.path || "";
  const src = srcFor(path);
  const ph = attacker ? PHASE[attacker.phase] : null;
  const agent = attacker ? (AGENT_NAME[attacker.agent] || attacker.agent) : null;

  return (
    <div className="absolute inset-0 flex flex-col p-3 pb-[104px]">
      <div className="flex-1 min-h-0 card overflow-hidden flex flex-col">
        {/* browser chrome */}
        <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-red/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-gold/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-win/70" />
          </div>
          {/* address bar */}
          <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/10">
            <span className="text-[11px] text-mute shrink-0">🔒</span>
            <span className="font-mono text-[12px] text-mute shrink-0">{ORIGIN.replace(/^https?:\/\//, "")}</span>
            <AnimatePresence mode="wait">
              <motion.span key={path || "root"} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
                className="font-mono text-[12px] text-text truncate">{path || "/"}</motion.span>
            </AnimatePresence>
          </div>
          {/* who + phase */}
          <div className="flex items-center gap-2 shrink-0">
            {agent && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red/12">
                <span className="w-1.5 h-1.5 rounded-full bg-red animate-pulse" />
                <span className="text-[11px] font-bold text-red">RED · {agent}</span>
              </span>
            )}
            {ph && <span className="text-[11px] font-bold px-2 py-1 rounded-md" style={{ background: `${ph.color}22`, color: ph.color }}>{ph.label}</span>}
          </div>
        </div>

        {/* live target — only mount the iframe when Red is actually hitting an
            endpoint (and the target is up during a match). Idle shows a clean
            placeholder, not a dead gray page. */}
        <div className="relative flex-1 min-h-0">
          {attacker ? (
            <iframe
              key={src}
              src={src}
              title="Attacker view — live target"
              className="absolute inset-0 w-full h-full bg-white"
              sandbox="allow-scripts allow-forms allow-same-origin"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-ink2">
              <div className="text-center max-w-[360px] px-6">
                <div className="w-12 h-12 rounded-2xl grid place-items-center mx-auto mb-4 bg-red/12 border border-red/30 text-[22px]">🛰</div>
                <div className="font-display font-bold text-[20px] text-text">Waiting for Red</div>
                <div className="text-[13px] text-mute mt-1.5 leading-snug">
                  The moment Red hits the target, this shows the exact endpoint and response it sees — live.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* request / response inspector — what the attacker is actually doing */}
        <div className="shrink-0 grid grid-cols-2 divide-x divide-white/10 border-t border-white/10 bg-white/[0.02] text-[12px]">
          <div className="px-4 py-2.5 min-w-0">
            <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-faint mb-0.5">Request</div>
            <div className="font-mono text-[12px] text-[#cdd9ef] truncate">
              {attacker ? `${attacker.tool} ${path}` : "—"}
            </div>
            {attacker?.note && <div className="font-mono text-[11px] text-mute truncate mt-0.5">{attacker.note}</div>}
          </div>
          <div className="px-4 py-2.5 min-w-0">
            <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-faint mb-0.5">Response</div>
            <div className="font-mono text-[12px] truncate" style={{ color: attacker?.status ? (attacker.phase === "blocked" ? "#2e90ff" : attacker.phase === "breached" ? "#ff3b50" : "#36e0a0") : "#8a97b4" }}>
              {attacker?.status ? `HTTP ${attacker.status}` : attacker ? "in flight…" : "—"}
            </div>
            {attacker?.evidence && <div className="font-mono text-[11px] text-mute truncate mt-0.5">{attacker.evidence}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
