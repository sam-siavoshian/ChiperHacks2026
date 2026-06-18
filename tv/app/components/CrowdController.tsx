"use client";

import { useEffect, useRef } from "react";
import type { CasterLine } from "@/lib/arenaState";

// Stadium crowd bed. A continuous loop whose volume ramps to the narrator's
// `crowd` intensity (0..1) for each line — quiet during routine play, swelling
// as danger builds, roaring on a goal. A one-shot roar layers on for goals.
// Ported from the partner's crowd_player.js (WebAudio). Degrades silently if the
// AudioContext is blocked or the SFX files are missing.
//
// Assets live in tv/public/audio/ (generated with ElevenLabs Sound Effects):
//   /audio/crowd_loop.mp3  — seamless ambient loop
//   /audio/goal_roar.mp3   — one-shot cheer for goals
const CROWD_LOOP_URL = "/audio/crowd_loop.mp3";
const GOAL_ROAR_URL = "/audio/goal_roar.mp3";
const MAX_GAIN = 0.55;   // gain at intensity = 1.0 (a bed under the voice, not over it)
const SMOOTHING = 0.7;   // seconds per volume ramp

export default function CrowdController({ caster }: { caster: CasterLine | null }) {
  const ctxRef = useRef<AudioContext | null>(null);
  const loopGainRef = useRef<GainNode | null>(null);
  const roarBufRef = useRef<AudioBuffer | null>(null);
  const startedRef = useRef(false);
  const lastIdRef = useRef<string | null>(null);

  // Build the audio graph once. Resumes on a user gesture if the browser
  // suspends the context (the Launch click usually already unlocked audio).
  useEffect(() => {
    let cancelled = false;
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AC) return;
    const ctx: AudioContext = new AC();
    ctxRef.current = ctx;

    const start = async () => {
      if (startedRef.current || cancelled) return;
      try {
        const loopGain = ctx.createGain();
        loopGain.gain.value = 0.0001;
        loopGain.connect(ctx.destination);
        loopGainRef.current = loopGain;

        const loopBuf = await fetchBuffer(ctx, CROWD_LOOP_URL);
        if (cancelled) return;
        const src = ctx.createBufferSource();
        src.buffer = loopBuf;
        src.loop = true;
        src.connect(loopGain);
        src.start();
        startedRef.current = true;
        fetchBuffer(ctx, GOAL_ROAR_URL).then((b) => { roarBufRef.current = b; }).catch(() => {});
      } catch {
        /* no crowd assets / decode failed — broadcast goes on without the bed */
      }
    };

    const onGesture = () => { ctx.resume().then(start).catch(() => {}); };
    if (ctx.state === "suspended") {
      window.addEventListener("pointerdown", onGesture, { once: true });
      window.addEventListener("keydown", onGesture, { once: true });
    }
    start();

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      try { ctx.close(); } catch { /* ignore */ }
      startedRef.current = false;
    };
  }, []);

  // Each new line: ramp the bed to its crowd level, and roar on a goal.
  useEffect(() => {
    const ctx = ctxRef.current, loopGain = loopGainRef.current;
    if (!ctx || !loopGain || !startedRef.current || !caster) return;
    if (lastIdRef.current === caster.id) return;
    lastIdRef.current = caster.id;

    const level = Math.max(0, Math.min(1, caster.crowd ?? 0.3));
    const target = Math.max(0.0001, Math.pow(level, 1.5) * MAX_GAIN); // ease-in: goals pop
    const now = ctx.currentTime;
    loopGain.gain.cancelScheduledValues(now);
    loopGain.gain.setValueAtTime(loopGain.gain.value, now);
    loopGain.gain.linearRampToValueAtTime(target, now + SMOOTHING);

    if (caster.emotion === "goal" && roarBufRef.current) {
      const src = ctx.createBufferSource();
      src.buffer = roarBufRef.current;
      const g = ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(ctx.destination);
      src.start();
    }
  }, [caster?.id, caster?.crowd, caster?.emotion]);

  return null; // audio-only, no DOM
}

async function fetchBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} ${res.status}`);
  const arr = await res.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}
