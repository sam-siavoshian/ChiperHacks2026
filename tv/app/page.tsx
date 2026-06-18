"use client";

import { useState } from "react";
import { AppPhase, MatchConfig, DEFAULT_CONFIG } from "@/lib/matchConfig";
import InitScreen from "./components/InitScreen";
import GeneratingScreen from "./components/GeneratingScreen";
import Broadcast from "./components/Broadcast";

// The unified TV app: configure the match (pick models) -> generating warmup
// (boots the arena + primes narrator/TTS for ~15s) -> live broadcast.
export default function Page() {
  const [phase, setPhase] = useState<AppPhase>("init");
  const [cfg, setCfg] = useState<MatchConfig>(DEFAULT_CONFIG);
  const [startedAt, setStartedAt] = useState(0);

  const launch = async (config: MatchConfig) => {
    setCfg(config);
    setStartedAt(performance.now());
    setPhase("generating");
    // unified kickoff: boot the arena + prime narrator/TTS (best-effort)
    try {
      await fetch("/api/match/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });
    } catch { /* arena may be offline; the broadcast still opens and waits for events */ }
  };

  if (phase === "init") return <InitScreen onLaunch={launch} />;
  if (phase === "generating") return <GeneratingScreen cfg={cfg} startedAt={startedAt} onReady={() => setPhase("live")} />;
  return <Broadcast cfg={cfg} />;
}
