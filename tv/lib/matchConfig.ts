// The operator's match setup: which model fights for each side, plus match length.
// Persisted to localStorage so a reload keeps the last setup. Sent to the arena on
// launch via POST /api/match/start.

export interface SidePick { lab: string; model: string; }
export interface MatchConfig { red: SidePick; blue: SidePick; rounds: number; }

export type AppPhase = "init" | "generating" | "live";

export const WARMUP_MS = 15000; // launch -> live window: lets the arena boot + the
                                // narrator LLM and TTS prime before the feed shows.

export const DEFAULT_CONFIG: MatchConfig = {
  red: { lab: "anthropic", model: "claude-opus-4-8" },
  blue: { lab: "anthropic", model: "claude-sonnet-4-6" },
  rounds: 25,
};

const KEY = "arena.matchConfig";

export function loadConfig(): MatchConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CONFIG;
    const j = JSON.parse(raw);
    if (j?.red?.lab && j?.red?.model && j?.blue?.lab && j?.blue?.model) {
      return { red: j.red, blue: j.blue, rounds: j.rounds || 25 };
    }
  } catch { /* ignore corrupt storage */ }
  return DEFAULT_CONFIG;
}

export function saveConfig(cfg: MatchConfig): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
