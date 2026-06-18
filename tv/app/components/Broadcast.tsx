"use client";

import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useBroadcast } from "@/lib/useBroadcast";
import { useVulns } from "@/lib/useVulns";
import { MatchConfig } from "@/lib/matchConfig";
import { modelName } from "@/lib/models";
import BroadcastBar from "./BroadcastBar";
import RedRail from "./RedRail";
import BlueRail from "./BlueRail";
import MainStage from "./MainStage";
import Overlays from "./Overlays";
import VulnBoard from "./VulnBoard";
import AudioController from "./AudioController";
import CrowdController from "./CrowdController";

export default function Broadcast({ cfg }: { cfg: MatchConfig }) {
  const { state, now, status } = useBroadcast();
  const [boardOpen, setBoardOpen] = useState(false);
  const vulns = useVulns(boardOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "b" || e.key === "B") setBoardOpen((v) => !v);
      if (e.key === "Escape") setBoardOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="relative h-screen w-screen bcast-floor overflow-hidden flex flex-col p-2 gap-2">
      <BroadcastBar state={state} status={status} />

      <div className="flex-1 min-h-0 grid grid-cols-[300px_1fr_300px] gap-2">
        <RedRail state={state} lab={cfg.red.lab} model={modelName(cfg.red.lab, cfg.red.model)} />
        <MainStage state={state} now={now} />
        <BlueRail state={state} lab={cfg.blue.lab} model={modelName(cfg.blue.lab, cfg.blue.model)} />
      </div>

      <DossierToggle data={vulns} onClick={() => setBoardOpen(true)} />
      <AudioController caster={state.caster} />
      <CrowdController caster={state.caster} />

      <Overlays state={state} now={now} status={status} />
      <AnimatePresence>{boardOpen && <VulnBoard data={vulns} onClose={() => setBoardOpen(false)} />}</AnimatePresence>
    </main>
  );
}

function DossierToggle({ data, onClick }: { data: ReturnType<typeof useVulns>; onClick: () => void }) {
  const real = data?.counts.real ?? 0;
  return (
    <button onClick={onClick}
      className="absolute z-[45] left-3 bottom-12 flex items-center gap-2 px-3 py-2 glass rounded-full hover:ring-1 hover:ring-blue/40 transition-all">
      <span className="text-[13px] text-blue">▦</span>
      <span className="text-[12px] font-bold text-text">Dossier</span>
      <span className="text-[12px] text-mute">{real} vulns</span>
      <span className="text-[11px] font-semibold text-blue/80">B</span>
    </button>
  );
}
