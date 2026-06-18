// Server-side broadcast hub. One in-memory fan-out shared by the ingest route
// (POST /api/events) and the browser stream (GET /api/stream). Producers push
// envelopes in; every connected TV gets them out. A bounded ring buffer lets a
// browser that joins mid-match replay and rebuild state.
//
// Pacing (the "live broadcast" feel):
//   - Tape delay (BROADCAST_DELAY_MS): hold every event N ms behind real time so
//     the agents get a head start during the generating window — by the time the
//     audience is watching, action is already buffered, never dead air. We watch a
//     little behind live, but the feed is continuous.
//   - Burst spacing (BROADCAST_MIN_GAP_MS): a single turn can dump several events
//     in a few ms (attempt -> vuln_found -> exploit_success -> score -> commentary).
//     We release them at least MIN_GAP apart so each beat lands and reads, instead
//     of flashing past in one frame. Bounded by MAX_EXTRA so a big burst (e.g. 37
//     recon nodes) can't push latency away without bound — it catches up.
//
// Survives Next.js dev HMR by living on globalThis.

import type { AnyEvent } from "./events";

export interface PaceOpts {
  delayMs: number;
  minGapMs: number;
  maxExtraMs: number;
}

// Pure scheduler: given when an event arrived, when the previous event is
// scheduled to show, and the pacing knobs, return the wall-clock time at which
// this event should be released. Monotonic (never before the previous release),
// so FIFO order is always preserved.
export function scheduleRelease(arrival: number, lastReleaseAt: number, opts: PaceOpts): number {
  const ideal = arrival + Math.max(0, opts.delayMs);
  // Space bursts out, but never let burst-spacing push an event more than
  // maxExtra past its ideal time — beyond that, events release together (catch up).
  let releaseAt = Math.max(ideal, lastReleaseAt + opts.minGapMs);
  releaseAt = Math.min(releaseAt, ideal + opts.maxExtraMs);
  // Keep strictly monotonic even after the cap clamps a long burst.
  if (releaseAt <= lastReleaseAt) releaseAt = lastReleaseAt + 1;
  return releaseAt;
}

interface HubState {
  buffer: AnyEvent[];
  subs: Set<(e: AnyEvent) => void>;
  pace: PaceOpts;
  lastReleaseAt: number; // wall-clock ms of the last scheduled release
  bufferCap: number;
}

const KEY = "__CYBER_ARENA_HUB__";

function num(env: string | undefined, fallback: number): number {
  const n = Number(env);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function build(): HubState {
  const pace: PaceOpts = {
    // A short tape lead, not a long buffer. ~6s is enough that the pre-roll opens on
    // action (the generating window is longer), but small enough that every move
    // still lands on-screen seconds after it really happens — live and fast-paced,
    // never "match ends, then the whole thing arrives." Events stream per-move; this
    // only sets how far behind real time, it never batches.
    delayMs: num(process.env.BROADCAST_DELAY_MS, 6000),
    minGapMs: num(process.env.BROADCAST_MIN_GAP_MS, 150),
    maxExtraMs: num(process.env.BROADCAST_MAX_EXTRA_MS, 4000),
  };
  return { buffer: [], subs: new Set(), pace, lastReleaseAt: 0, bufferCap: 1000 };
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
  if (h.pace.delayMs <= 0 && h.pace.minGapMs <= 0) {
    fanout(h, ev);
    return;
  }
  const now = Date.now();
  // Reset the pacing clock if we've been idle past a full delay window, so a new
  // match (or a long lull) doesn't inherit a stale lastReleaseAt and over-delay.
  if (h.lastReleaseAt < now - h.pace.delayMs - h.pace.maxExtraMs) h.lastReleaseAt = 0;
  const releaseAt = scheduleRelease(now, h.lastReleaseAt, h.pace);
  h.lastReleaseAt = releaseAt;
  const wait = Math.max(0, releaseAt - now);
  if (wait === 0) fanout(h, ev);
  else setTimeout(() => fanout(h, ev), wait);
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
  return { buffered: h.buffer.length, subscribers: h.subs.size, delayMs: h.pace.delayMs, minGapMs: h.pace.minGapMs };
}

// Wipe the buffer + reset pacing (e.g. a fresh match). Producers can call via
// POST /api/events with a {control:"reset"} body — see the ingest route.
export function resetBuffer(): void {
  const h = hub();
  h.buffer.length = 0;
  h.lastReleaseAt = 0;
}
