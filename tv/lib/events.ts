// CYBER ARENA shared event contract — broadcast frontend copy.
// Mirrors contract/events.ts (the bus seam) and extends `commentary` with the
// fields the AI caster / TTS layer will fill in later. Keep in lockstep with the
// Python relay when that lands.

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
export type BlueAction = "regex_block" | "param_allowlist" | "rate_limit" | "block_token";

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
  ts: number; // epoch ms (source time, before the broadcast delay)
  round: number; // 0 = lobby
  agent: AgentId;
  type: EventType;
  target: string | null;
  payload: T;
}

// --- payloads ---------------------------------------------------------------
export interface RoundStartP { round: number; redScore: number; blueScore: number; title: string; vulnClass: string; }
export interface RoundEndP { round: number; summary: string; duration_ms: number; winner: Winner; }
export interface HandoffP { from: AgentId; to: AgentId; }
export interface AssetDiscoveredP {
  id: string; label: string; kind: AssetKind;
  parentId: string | null; method: string | null; params: string[];
}
export interface AttemptingP { agent: AgentId; tool: string; target: string; note: string; }
export interface VulnFoundP { class: string; severity: Severity; url: string; }
export interface ExploitSuccessP {
  class: string; url: string; evidence: string; loot_ref: string | null; trophy: string; assetId?: string;
}
export interface BlueDetectP { threat: string; assetId: string; confidence: number; }
export interface BlueMitigateP { action: BlueAction; rule_id: string; assetId: string; rule: Record<string, unknown>; label: string; }
export interface BlueBlockedP { rule_id: string; url: string; status: number; }
export interface ScoreUpdateP { red: number; blue: number; assetsOwned: number; health: number; }
export interface TimerP { secondsLeft: number; }
export interface ExfilChunkP { filename: string; bytes: number; b64snippet: string; }
// Extended for the broadcast: the caster's line. `words` carries per-word reveal
// offsets (ms from line start) so captions track the voice; `audioUrl`/`durationMs`
// get filled by the self-hosted TTS service when it exists. All optional today.
export interface CommentaryP {
  text: string;
  intensity: "calm" | "normal" | "hype";
  trigger: string;
  caster?: string;
  audioUrl?: string | null;
  durationMs?: number;
  words?: { t: number; w: string }[];
  // emotion-aware narration (filled by the narrator): `emotion` picks the voice
  // delivery, `crowd` (0..1) drives the stadium crowd bed volume.
  emotion?: "goal" | "save" | "setback" | "buildup" | "tense" | "neutral";
  crowd?: number;
}
export interface ErrorP { tool: string; msg: string; }

export type AnyEvent =
  | Envelope<RoundStartP>
  | Envelope<RoundEndP>
  | Envelope<HandoffP>
  | Envelope<AssetDiscoveredP>
  | Envelope<AttemptingP>
  | Envelope<VulnFoundP>
  | Envelope<ExploitSuccessP>
  | Envelope<BlueDetectP>
  | Envelope<BlueMitigateP>
  | Envelope<BlueBlockedP>
  | Envelope<ScoreUpdateP>
  | Envelope<TimerP>
  | Envelope<ExfilChunkP>
  | Envelope<CommentaryP>
  | Envelope<ErrorP>;

// delayed broadcast stream (the relay will serve this). Mock today.
export const WS_BROADCAST = "ws://127.0.0.1:8770/broadcast";

let _seq = 0;
export function makeId(): string {
  _seq = (_seq + 1) & 0xffffff;
  return `evt_${_seq.toString(36).padStart(4, "0")}`;
}
