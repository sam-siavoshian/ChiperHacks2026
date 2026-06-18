// Validation + sanitization for inbound events. The ingest endpoint is open to
// "anywhere" (arena backend, MCP server, agents, curl), so treat every payload
// as untrusted: enforce the envelope shape, whitelist the type, coerce/clamp
// every field, and bound string + object sizes so a hostile or buggy producer
// cannot blow up the browser or exhaust memory. React escapes text on render,
// so XSS is not the risk here; unbounded/garbage data is.

import type { AnyEvent, EventType, AgentId } from "./events";

const EVENT_TYPES: ReadonlySet<string> = new Set([
  "round_start", "round_end", "handoff", "asset.discovered", "attempting",
  "agent.thinking", "vuln_found", "exploit_success", "blue.detect", "blue.mitigate",
  "blue.blocked", "score.update", "timer", "exfil.chunk", "commentary", "error",
]);

const AGENT_IDS: ReadonlySet<string> = new Set([
  "orchestrator", "recon", "web_exploit", "auth", "exfil", "blue", "caster", "system",
]);

const MAX_STR = 600;       // any single string field
const MAX_KEYS = 40;       // keys per payload object
const MAX_DEPTH = 4;       // payload nesting
const MAX_ARRAY = 64;      // array length in a payload

function clampStr(s: string): string {
  return s.length > MAX_STR ? s.slice(0, MAX_STR) : s;
}

// recursively copy + bound an untrusted value
function sanitize(v: unknown, depth: number): unknown {
  if (v === null) return null;
  switch (typeof v) {
    case "string": return clampStr(v);
    case "number": return Number.isFinite(v) ? v : 0;
    case "boolean": return v;
    case "object": {
      if (depth >= MAX_DEPTH) return null;
      if (Array.isArray(v)) return v.slice(0, MAX_ARRAY).map((x) => sanitize(x, depth + 1));
      const out: Record<string, unknown> = {};
      let n = 0;
      for (const k of Object.keys(v as object)) {
        if (n++ >= MAX_KEYS) break;
        out[clampStr(k)] = sanitize((v as any)[k], depth + 1);
      }
      return out;
    }
    default: return null; // function, undefined, symbol, bigint
  }
}

export interface ParseResult { ok: AnyEvent[]; rejected: number; }

// Accept a single envelope or an array; return only the valid, sanitized ones.
export function parseEnvelopes(input: unknown): ParseResult {
  const list = Array.isArray(input) ? input : [input];
  const ok: AnyEvent[] = [];
  let rejected = 0;

  for (const raw of list.slice(0, 256)) {
    if (!raw || typeof raw !== "object") { rejected++; continue; }
    const r = raw as Record<string, unknown>;
    const type = typeof r.type === "string" ? r.type : "";
    if (!EVENT_TYPES.has(type)) { rejected++; continue; }
    if (!r.payload || typeof r.payload !== "object") { rejected++; continue; }

    const agent = typeof r.agent === "string" && AGENT_IDS.has(r.agent) ? r.agent : "system";
    const env = {
      id: typeof r.id === "string" && r.id ? clampStr(r.id) : `evt_${Math.round(perfNow() * 1000).toString(36)}_${ok.length}`,
      ts: typeof r.ts === "number" && Number.isFinite(r.ts) ? r.ts : Date.now(),
      round: typeof r.round === "number" && Number.isFinite(r.round) ? Math.max(0, Math.min(99, r.round | 0)) : 0,
      agent: agent as AgentId,
      type: type as EventType,
      target: typeof r.target === "string" ? clampStr(r.target) : null,
      payload: sanitize(r.payload, 1) as Record<string, unknown>,
    } as unknown as AnyEvent;
    ok.push(env);
  }
  return { ok, rejected };
}

// Date.now is fine on the server; this just avoids importing it twice.
function perfNow(): number { return Date.now(); }
