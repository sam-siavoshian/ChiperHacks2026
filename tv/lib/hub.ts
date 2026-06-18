// Server-side broadcast hub. One in-memory fan-out shared by the ingest route
// (POST /api/events) and the browser stream (GET /api/stream). Producers push
// envelopes in; every connected TV gets them out. A bounded ring buffer lets a
// browser that joins mid-match replay and rebuild state. Optional tape delay
// (BROADCAST_DELAY_MS) holds events before fan-out so a later TTS/caster layer
// has a window to react, exactly like a live-TV broadcast.
//
// Survives Next.js dev HMR by living on globalThis.

import type { AnyEvent } from "./events";

interface HubState {
  buffer: AnyEvent[];
  subs: Set<(e: AnyEvent) => void>;
  delayMs: number;
  bufferCap: number;
}

const KEY = "__CYBER_ARENA_HUB__";

function build(): HubState {
  const delayMs = Number(process.env.BROADCAST_DELAY_MS ?? 0) || 0;
  return { buffer: [], subs: new Set(), delayMs, bufferCap: 1000 };
}

function hub(): HubState {
  const g = globalThis as any;
  if (!g[KEY]) g[KEY] = build();
  return g[KEY] as HubState;
}

function fanout(h: HubState, ev: AnyEvent) {
  h.buffer.push(ev);
  if (h.buffer.length > h.bufferCap) h.buffer.splice(0, h.buffer.length - h.bufferCap);
  for (const cb of h.subs) {
    try { cb(ev); } catch { /* a dead subscriber must never break the fan-out */ }
  }
}

export function publish(ev: AnyEvent): void {
  const h = hub();
  if (h.delayMs > 0) setTimeout(() => fanout(h, ev), h.delayMs);
  else fanout(h, ev);
}

export function publishMany(evs: AnyEvent[]): void {
  for (const ev of evs) publish(ev);
}

// Subscribe to the live feed. Returns an unsubscribe fn. `replay` controls
// whether the current ring buffer is delivered immediately (for late joiners).
export function subscribe(cb: (e: AnyEvent) => void, replay = true): () => void {
  const h = hub();
  if (replay) for (const ev of h.buffer) { try { cb(ev); } catch { /* ignore */ } }
  h.subs.add(cb);
  return () => { h.subs.delete(cb); };
}

export function stats() {
  const h = hub();
  return { buffered: h.buffer.length, subscribers: h.subs.size, delayMs: h.delayMs };
}

// Wipe the buffer (e.g. a fresh match). Producers can call via POST /api/events
// with a {control:"reset"} body — see the ingest route.
export function resetBuffer(): void {
  hub().buffer.length = 0;
}
