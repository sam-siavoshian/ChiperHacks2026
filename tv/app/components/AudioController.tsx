"use client";

import { useEffect, useRef, useState } from "react";
import type { CasterLine } from "@/lib/arenaState";

// Streams the narrator's voice. Each commentary line may carry an `audioUrl` (the
// TTS clip); when a new line arrives with one, we play it. The launch click
// unlocked autoplay, so playback just works. Degrades silently to captions-only
// when no audio is supplied (TTS layer not wired yet). A mute toggle is exposed.
export default function AudioController({ caster }: { caster: CasterLine | null }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const lastId = useRef<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const a = audio.current;
    if (!a || !caster?.audioUrl || lastId.current === caster.id) return;
    lastId.current = caster.id;
    a.src = caster.audioUrl;
    a.muted = muted;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [caster?.id, caster?.audioUrl, muted]);

  return (
    <>
      <audio ref={audio} preload="auto" onEnded={() => setPlaying(false)} />
      <button
        onClick={() => { setMuted((m) => { if (audio.current) audio.current.muted = !m; return !m; }); }}
        className="absolute z-[45] right-3 bottom-12 flex items-center gap-2 px-3 py-1.5 panel hover:border-blue/50 transition-colors"
        title="Toggle commentary audio">
        <span className={`text-[13px] ${muted ? "text-mute" : "text-win"}`}>{muted ? "🔇" : "🔊"}</span>
        <div className="text-left leading-none">
          <div className="font-hud font-bold text-[10px] tracking-[0.12em] text-[#cfe0ff]">COMMENTARY</div>
          <div className="font-mono text-[8px] tracking-[0.14em] text-mute mt-0.5">
            {muted ? "MUTED" : playing ? "ON AIR" : "READY"}
          </div>
        </div>
      </button>
    </>
  );
}
