// Local mirror of the shared CYBER ARENA event contract (root contract/events.ts,
// owned jointly with the TV/broadcast lane). Vendored here so the arena is
// self-contained and does not break if the shared file is moved during the build.
// The WIRE SHAPE must stay in lockstep with the shared contract. If you change an
// event shape, change it in both places (coordinate with the TV lane).

export type AgentId =
  | "orchestrator"
  | "recon"
  | "web_exploit"
  | "auth"
  | "exfil"
  | "blue"
  | "caster"
  | "system";

export type AssetKind = "host" | "service" | "cred" | "db" | "file";
export type Severity = "low" | "medium" | "high" | "critical";
export type Winner = "red" | "blue";

export type EventType =
  | "round_start"
  | "round_end"
  | "handoff"
  | "asset.discovered"
  | "attempting"
  | "vuln_found"
  | "exploit_success"
  | "blue.detect"
  | "blue.mitigate"
  | "blue.blocked"
  | "score.update"
  | "timer"
  | "exfil.chunk"
  | "commentary"
  | "error";

export interface Envelope<T = Record<string, unknown>> {
  id: string;
  ts: number;
  round: number;
  agent: AgentId;
  type: EventType;
  target: string | null;
  payload: T;
}

export const WS_BROADCAST = "ws://127.0.0.1:8770/broadcast";

let _seq = 0;
export function makeId(): string {
  _seq = (_seq + 1) & 0xffffff;
  return `evt_${_seq.toString(36).padStart(4, "0")}`;
}
