// Emits shared-contract events (contract/events.ts) to the event bus. Falls back
// to stdout when the bus is down so the arena runs standalone. Fire-and-forget.

import type { AgentId, EventType, Envelope } from "../contract/events";
import { makeId } from "../contract/events";

// The live event sink is the TV broadcast ingest (tv/app/api/events). Override
// with ARENA_BUS_EMIT if a relay is introduced later.
const BUS_EMIT = process.env.ARENA_BUS_EMIT ?? "http://127.0.0.1:3100/api/events";
let round = 0;
const log: Envelope[] = [];

export function setRound(r: number) {
  round = r;
}

export function emit<T extends Record<string, unknown>>(
  agent: AgentId,
  type: EventType,
  target: string | null,
  payload: T
): Envelope<T> {
  const env: Envelope<T> = { id: makeId(), ts: Date.now(), round, agent, type, target, payload };
  log.push(env as Envelope);
  // Best-effort delivery to the bus; never block or throw.
  fetch(BUS_EMIT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(env),
  }).catch(() => {});
  if (process.env.ARENA_LOG_EVENTS === "1") {
    console.log(`[evt] ${type}${target ? `(${target})` : ""} ${JSON.stringify(payload)}`);
  }
  return env;
}

export function eventLog(): Envelope[] {
  return log;
}
