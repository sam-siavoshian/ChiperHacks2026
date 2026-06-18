"use client";

// Single source of truth for the TV. Connects to the live SSE feed at
// /api/stream, buffers incoming events, drains them once per rAF, folds them
// through the pure reducer. A throttled `now` drives time-based bits (caption
// reveal, breach window) without a per-frame React storm.
//
// On (re)connect the server replays its ring buffer, so we reset to a clean
// state first and let the replay rebuild it — no double-counting on reconnect.
// `status` lets the UI show a connection indicator (no fake data when idle).

import { useEffect, useRef, useState } from "react";
import type { AnyEvent } from "./events";
import { ArenaState, initialState, reduce } from "./arenaState";

export type ConnStatus = "connecting" | "live" | "down";

export function useBroadcast(): { state: ArenaState; now: number; status: ConnStatus } {
  const [state, setState] = useState<ArenaState>(initialState);
  const [now, setNow] = useState(0);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const stateRef = useRef<ArenaState>(state);
  const pending = useRef<AnyEvent[]>([]);

  useEffect(() => {
    const es = new EventSource("/api/stream");

    es.onopen = () => {
      // fresh connection => server is about to replay the buffer; start clean
      stateRef.current = initialState();
      pending.current = [];
      setState(stateRef.current);
      setStatus("live");
    };
    es.onerror = () => setStatus((s) => (s === "live" ? "down" : "connecting"));
    es.onmessage = (e) => {
      try { pending.current.push(JSON.parse(e.data) as AnyEvent); } catch { /* drop malformed frame */ }
    };

    let raf = 0;
    let lastTick = 0;
    const loop = () => {
      const t = performance.now();
      if (pending.current.length) {
        const batch = pending.current;
        pending.current = [];
        let st = stateRef.current;
        for (const ev of batch) st = reduce(st, ev, t);
        stateRef.current = st;
        setState(st);
      }
      if (t - lastTick > 50) { lastTick = t; setNow(t); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => { es.close(); cancelAnimationFrame(raf); };
  }, []);

  return { state, now, status };
}
