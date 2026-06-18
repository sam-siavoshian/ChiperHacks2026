// Pure fold: a stream of contract events -> the state the broadcast UI renders.
// Ephemeral one-shots (breach, blocked-proof, replay) are stamped with a time so
// components can decide visibility by elapsed; nothing here touches the DOM.

import type {
  AnyEvent, AgentId, AssetKind, BlueAction,
  RoundStartP, RoundEndP, HandoffP, AssetDiscoveredP, AttemptingP, ThinkingP, VulnFoundP,
  ExploitSuccessP, BlueDetectP, BlueMitigateP, BlueBlockedP, ScoreUpdateP, TimerP,
  ExfilChunkP, CommentaryP, ErrorP, Winner,
} from "./events";

export type Phase = "lobby" | "round" | "break" | "final";

export interface GNode {
  id: string; label: string; kind: AssetKind;
  parentId: string | null; bornAt: number; owned: boolean; flagged: boolean; shielded: boolean;
}
export interface GLink { source: string; target: string; active: boolean; }

export interface FeedLine {
  id: string; ts: number; agent: AgentId;
  kind: "attempt" | "vuln" | "win" | "detect" | "mitigate" | "blocked" | "error" | "info" | "handoff" | "think";
  text: string; sub?: string; sev?: string; n?: number;
}

export interface BlueRule {
  id: string; action: BlueAction; label: string; assetId: string; hits: number; ts: number;
}

export interface ExfilItem { id: string; filename: string; bytes: number; snippet: string; ts: number; }

export interface CasterLine {
  id: string; text: string; words: { t: number; w: string }[];
  startedAt: number; intensity: CommentaryP["intensity"]; caster: string;
  audioUrl: string | null; // TTS clip for this line, when the voice layer supplies it
  emotion: NonNullable<CommentaryP["emotion"]>; // drives the crowd cheer trigger
  crowd: number; // 0..1, drives the stadium crowd bed volume
}

export interface BreachBeat { id: string; trophy: string; host: string; url: string; cls: string; at: number; }
export interface BlockedProof { id: string; url: string; ruleId: string; at: number; }

// Where Red is right now + what it is doing — drives the "Attacker View" panel
// (a live look at the endpoint it is hitting and the request/response).
export interface AttackerView {
  agent: AgentId; tool: string; path: string; note: string;
  status: number | null; evidence: string | null;
  phase: "probing" | "found" | "breached" | "blocked";
  at: number;
}

// What Blue is doing right now — drives the "Defender View" panel (the threat it
// caught, the patch/rule it deployed, and the block proof).
export interface DefenderView {
  phase: "watching" | "detected" | "patched" | "blocked";
  action: string | null; target: string; threat: string | null;
  label: string | null; rule: Record<string, unknown> | null;
  status: number | null; at: number;
}
export interface TickerItem { id: string; tone: "red" | "blue" | "amber" | "win"; text: string; }

// Live per-turn tool-call budget for one side — drives the "tools left this turn"
// HUD. `tool` is the latest tool that side called; the counts are the most recent
// budget snapshot carried on an `attempting` event (native tapped calls update the
// tool name but leave the counts as last seen).
export interface BudgetHUD {
  tool: string; budget: number; used: number; remaining: number; at: number;
}

export interface ArenaState {
  phase: Phase;
  round: number; roundTitle: string; vulnClass: string;
  redScore: number; blueScore: number;
  assetsOwned: number; health: number;
  secondsLeft: number;
  activeAgent: AgentId | null;
  agentStatus: Record<string, "idle" | "active" | "handoff">;
  agentLast: Record<string, string>;
  nodes: GNode[]; links: GLink[];
  feedRed: FeedLine[]; feedBlue: FeedLine[];
  rules: BlueRule[];
  exfil: ExfilItem[];
  caster: CasterLine | null;
  attacker: AttackerView | null;
  defender: DefenderView | null;
  redBudget: BudgetHUD | null;  // RED's live tool-call budget this turn
  blueBudget: BudgetHUD | null; // BLUE's live tool-call budget this turn
  // Live per-vuln verdict, keyed by vuln id, driven straight off the event stream
  // (exploit_success -> red_scored, blue.mitigate -> blue_saved). Lets the dossier
  // counts move the instant a goal/save lands, with no control-plane HTTP poll.
  vulnStatus: Record<string, "red_scored" | "blue_saved">;
  breach: BreachBeat | null;
  proof: BlockedProof | null;
  ticker: TickerItem[];
  roundResult: { round: number; winner: Winner; summary: string } | null;
  roundAt: number; // perf.now stamp of last round_start (drives the intro card)
  resultAt: number; // perf.now stamp of last round_end (drives the result card)
  rev: number; // bumped on every fold so memo consumers can cheaply detect change
}

export const RED_AGENTS: AgentId[] = ["recon", "web_exploit", "auth", "exfil"];

// Root target node label. Neutral by default; set NEXT_PUBLIC_TARGET_LABEL to
// name the real target. asset.discovered events relabel/expand the graph from here.
const TARGET_LABEL = process.env.NEXT_PUBLIC_TARGET_LABEL || "target";
const rootNode = (bornAt: number): GNode => ({
  id: "target", label: TARGET_LABEL, kind: "host", parentId: null,
  bornAt, owned: false, flagged: false, shielded: false,
});

export function initialState(): ArenaState {
  return {
    phase: "lobby",
    round: 0, roundTitle: "", vulnClass: "",
    redScore: 0, blueScore: 0,
    assetsOwned: 0, health: 100,
    secondsLeft: 0,
    activeAgent: null,
    agentStatus: { recon: "idle", web_exploit: "idle", auth: "idle", exfil: "idle", blue: "idle" },
    agentLast: {},
    nodes: [rootNode(0)],
    links: [],
    feedRed: [], feedBlue: [],
    rules: [],
    exfil: [],
    caster: null,
    attacker: null,
    defender: null,
    redBudget: null,
    blueBudget: null,
    vulnStatus: {},
    breach: null,
    proof: null,
    ticker: [],
    roundResult: null,
    roundAt: 0,
    resultAt: 0,
    rev: 0,
  };
}

const FEED_CAP = 60;
const cap = <T>(arr: T[], line: T, n = FEED_CAP) => {
  const out = arr.concat(line);
  return out.length > n ? out.slice(out.length - n) : out;
};

// Console append that collapses a run of identical lines into one with a ×N
// counter — kills the "$ claim_exploit sqli" wall of repeats.
const pushFeed = (arr: FeedLine[], line: FeedLine): FeedLine[] => {
  const last = arr[arr.length - 1];
  if (last && last.kind === line.kind && last.text === line.text && (last.sub || "") === (line.sub || "")) {
    const merged: FeedLine = { ...last, n: (last.n || 1) + 1, ts: line.ts };
    return arr.slice(0, -1).concat(merged);
  }
  const out = arr.concat(line);
  return out.length > FEED_CAP ? out.slice(out.length - FEED_CAP) : out;
};

// turn raw text into per-word reveal offsets when the TTS layer did not supply them
function autoWords(text: string, intensity: CommentaryP["intensity"]): { t: number; w: string }[] {
  const per = intensity === "hype" ? 200 : intensity === "calm" ? 320 : 250;
  let t = 120;
  return text.split(/\s+/).filter(Boolean).map((w) => {
    const cur = t;
    t += per + Math.min(160, w.length * 16);
    return { t: cur, w };
  });
}

export function reduce(s: ArenaState, ev: AnyEvent, now: number): ArenaState {
  const n: ArenaState = { ...s, rev: s.rev + 1 };
  const p = ev.payload as any;

  switch (ev.type) {
    case "round_start": {
      const rp = p as RoundStartP;
      n.phase = "round";
      n.round = rp.round; n.roundTitle = rp.title; n.vulnClass = rp.vulnClass;
      n.redScore = rp.redScore; n.blueScore = rp.blueScore;
      n.roundResult = null; n.breach = null; n.proof = null;
      n.activeAgent = null;
      n.agentStatus = { recon: "idle", web_exploit: "idle", auth: "idle", exfil: "idle", blue: "idle" };
      // fresh target each round, reset ownership/shields, keep the show legible
      n.nodes = [rootNode(now)];
      n.links = [];
      n.health = 100; n.assetsOwned = 0;
      n.attacker = null;
      n.defender = null;
      n.redBudget = null; n.blueBudget = null; // fresh per-turn budget each round
      n.roundAt = now;
      n.ticker = cap(n.ticker, { id: ev.id, tone: "amber", text: `ROUND ${rp.round} — ${rp.title.toUpperCase()}` }, 24);
      break;
    }
    case "round_end": {
      const rp = p as RoundEndP;
      n.roundResult = { round: rp.round, winner: rp.winner, summary: rp.summary };
      n.resultAt = now;
      n.phase = rp.round >= 3 ? "final" : "break";
      n.activeAgent = null;
      n.agentStatus = { ...n.agentStatus, recon: "idle", web_exploit: "idle", auth: "idle", exfil: "idle", blue: "idle" };
      break;
    }
    case "handoff": {
      const hp = p as HandoffP;
      n.activeAgent = hp.to;
      n.agentStatus = { ...n.agentStatus };
      for (const a of RED_AGENTS) n.agentStatus[a] = a === hp.to ? "active" : (n.agentStatus[a] === "active" ? "idle" : n.agentStatus[a]);
      n.agentStatus[hp.to] = "active";
      n.feedRed = pushFeed(n.feedRed, { id: ev.id, ts: ev.ts, agent: hp.to, kind: "handoff", text: `▶ HANDOFF → ${hp.to.toUpperCase()}` });
      break;
    }
    case "asset.discovered": {
      const ap = p as AssetDiscoveredP;
      if (!n.nodes.find((x) => x.id === ap.id)) {
        n.nodes = n.nodes.concat({ id: ap.id, label: ap.label, kind: ap.kind, parentId: ap.parentId, bornAt: now, owned: false, flagged: false, shielded: false });
        if (ap.parentId) n.links = n.links.concat({ source: ap.parentId, target: ap.id, active: false });
      }
      // discovered assets show on the graph + dossier — keep them out of the console
      // so it stays a readable log of what Red is actually *doing*.
      break;
    }
    case "attempting": {
      const at = p as AttemptingP;
      const d = at.detail || {};
      // a richer console sub-line: the actual payload / what came back, when we have it
      const sub = d.payload
        ? `${at.note}  ⟶  ${d.payload}`
        : d.status != null
          ? `${at.note}  ·  ${d.status}${d.bodyLen != null ? ` (${d.bodyLen}b)` : ""}${d.blocked ? " · BLOCKED" : ""}`
          : at.note;
      n.agentLast = { ...n.agentLast, [at.agent]: `${at.tool} ${at.target}` };
      // live per-turn tool-call budget HUD: always refresh the latest tool name;
      // carry the counts forward when this event lacks a budget snapshot (e.g.
      // BLUE's native tapped Read/Edit, which do not charge the MCP budget).
      if (at.tool) {
        const side = at.agent === "blue" ? "blueBudget" : "redBudget";
        const prev = n[side];
        const hasB = typeof d.remaining === "number" && typeof d.budget === "number";
        n[side] = {
          tool: at.tool,
          budget: hasB ? (d.budget as number) : (prev?.budget ?? 0),
          used: typeof d.used === "number" ? d.used : (prev?.used ?? 0),
          remaining: hasB ? (d.remaining as number) : (prev?.remaining ?? 0),
          at: now,
        };
      }
      if (at.agent === "blue") {
        // BLUE's native source surgery (Read/Edit/...) surfaced by the session tap
        n.feedBlue = pushFeed(n.feedBlue, { id: ev.id, ts: ev.ts, agent: "blue", kind: "attempt", text: `$ ${at.tool}${d.file ? ` ${d.file}` : ""}`, sub });
      } else {
        n.attacker = {
          agent: at.agent, tool: at.tool, path: at.target || "", note: at.note || "",
          status: d.status ?? null, evidence: d.bodySnippet ?? null,
          phase: d.blocked ? "blocked" : "probing", at: now,
        };
        n.feedRed = pushFeed(n.feedRed, { id: ev.id, ts: ev.ts, agent: at.agent, kind: "attempt", text: `$ ${at.tool}`, sub });
      }
      break;
    }
    case "agent.thinking": {
      const tp = p as ThinkingP;
      const line: FeedLine = { id: ev.id, ts: ev.ts, agent: tp.agent, kind: "think", text: `🧠 ${tp.text}` };
      if (tp.agent === "blue") n.feedBlue = pushFeed(n.feedBlue, line);
      else n.feedRed = pushFeed(n.feedRed, line);
      break;
    }
    case "vuln_found": {
      const vp = p as VulnFoundP;
      n.attacker = { ...(n.attacker ?? { agent: ev.agent, tool: "probe", note: "", status: null, evidence: null, at: now }), path: vp.url || n.attacker?.path || "", phase: "found", at: now } as any;
      n.feedRed = pushFeed(n.feedRed, { id: ev.id, ts: ev.ts, agent: ev.agent, kind: "vuln", text: `! ${vp.class}`, sub: vp.url, sev: vp.severity });
      n.ticker = cap(n.ticker, { id: ev.id, tone: "red", text: `VULN ${vp.class.toUpperCase()} (${vp.severity})` }, 24);
      break;
    }
    case "exploit_success": {
      const xp = p as ExploitSuccessP;
      n.redScore += 3;
      n.assetsOwned += 1;
      n.health = Math.max(0, n.health - 34);
      const aid = xp.assetId && n.nodes.find((x) => x.id === xp.assetId) ? xp.assetId : "target";
      n.nodes = n.nodes.map((x) => (x.id === aid ? { ...x, owned: true } : x));
      n.links = n.links.map((l) => (l.target === aid ? { ...l, active: true } : l));
      n.breach = { id: ev.id, trophy: xp.trophy, host: aid, url: xp.url, cls: xp.class, at: now };
      n.attacker = { agent: ev.agent, tool: n.attacker?.tool || "exploit", path: xp.url || n.attacker?.path || "", note: n.attacker?.note || xp.trophy, status: 200, evidence: xp.evidence || null, phase: "breached", at: now };
      n.feedRed = pushFeed(n.feedRed, { id: ev.id, ts: ev.ts, agent: ev.agent, kind: "win", text: `★ BREACH ${xp.class}`, sub: xp.evidence });
      n.ticker = cap(n.ticker, { id: ev.id, tone: "red", text: `RED SCORES +3 — ${xp.trophy.toUpperCase()}` }, 24);
      // mark the real vuln (the event target / assetId is the vuln id) red_scored
      {
        const vid = (typeof ev.target === "string" && ev.target) || xp.assetId;
        if (vid && vid !== "target") n.vulnStatus = { ...s.vulnStatus, [vid]: "red_scored" };
      }
      break;
    }
    case "blue.detect": {
      const bp = p as BlueDetectP;
      n.nodes = n.nodes.map((x) => (x.id === bp.assetId ? { ...x, flagged: true } : x));
      n.defender = { phase: "detected", action: null, target: bp.assetId, threat: bp.threat, label: null, rule: null, status: null, at: now };
      n.feedBlue = pushFeed(n.feedBlue, { id: ev.id, ts: ev.ts, agent: "blue", kind: "detect", text: `◎ DETECT ${bp.threat}`, sub: `conf ${(bp.confidence * 100) | 0}%` });
      break;
    }
    case "blue.mitigate": {
      const bp = p as BlueMitigateP;
      n.blueScore += 5;
      n.nodes = n.nodes.map((x) => (x.id === bp.assetId ? { ...x, shielded: true } : x));
      n.rules = cap(n.rules, { id: bp.rule_id, action: bp.action, label: bp.label, assetId: bp.assetId, hits: 0, ts: ev.ts }, 12);
      n.defender = { phase: "patched", action: bp.action, target: bp.assetId, threat: n.defender?.threat ?? null, label: bp.label, rule: bp.rule ?? null, status: null, at: now };
      n.feedBlue = pushFeed(n.feedBlue, { id: ev.id, ts: ev.ts, agent: "blue", kind: "mitigate", text: `⛨ DEPLOY ${bp.action}`, sub: bp.label });
      n.ticker = cap(n.ticker, { id: ev.id, tone: "blue", text: `BLUE PATCHES +5 — ${bp.action.toUpperCase()}` }, 24);
      // mark the real vuln blue_saved (unless RED already scored it earlier)
      {
        const vid = (typeof ev.target === "string" && ev.target) || bp.assetId;
        if (vid && vid !== "target" && s.vulnStatus[vid] !== "red_scored") {
          n.vulnStatus = { ...s.vulnStatus, [vid]: "blue_saved" };
        }
      }
      break;
    }
    case "blue.blocked": {
      const bp = p as BlueBlockedP;
      n.proof = { id: ev.id, url: bp.url, ruleId: bp.rule_id, at: now };
      if (n.attacker) n.attacker = { ...n.attacker, path: bp.url || n.attacker.path, status: bp.status || 403, phase: "blocked", evidence: `Blocked by Blue (${bp.status || 403})`, at: now };
      n.defender = { phase: "blocked", action: n.defender?.action ?? null, target: bp.url || n.defender?.target || "", threat: n.defender?.threat ?? null, label: n.defender?.label ?? null, rule: n.defender?.rule ?? null, status: bp.status || 403, at: now };
      n.rules = n.rules.map((r) => (r.id === bp.rule_id ? { ...r, hits: r.hits + 1 } : r));
      n.feedBlue = pushFeed(n.feedBlue, { id: ev.id, ts: ev.ts, agent: "blue", kind: "blocked", text: `✕ BLOCKED ${bp.status}`, sub: bp.url });
      n.ticker = cap(n.ticker, { id: ev.id, tone: "win", text: `BLOCKED BY BLUE — 403 — SAME PAYLOAD` }, 24);
      break;
    }
    case "score.update": {
      const sp = p as ScoreUpdateP;
      n.redScore = sp.red; n.blueScore = sp.blue;
      n.assetsOwned = sp.assetsOwned; n.health = sp.health;
      break;
    }
    case "timer": {
      n.secondsLeft = (p as TimerP).secondsLeft;
      break;
    }
    case "exfil.chunk": {
      const ep = p as ExfilChunkP;
      n.exfil = cap(n.exfil, { id: ev.id, filename: ep.filename, bytes: ep.bytes, snippet: ep.b64snippet, ts: ev.ts }, 8);
      break;
    }
    case "commentary": {
      const cp = p as CommentaryP;
      n.caster = {
        id: ev.id, text: cp.text,
        words: cp.words && cp.words.length ? cp.words : autoWords(cp.text, cp.intensity),
        startedAt: now, intensity: cp.intensity, caster: cp.caster || "THE ANALYST",
        audioUrl: cp.audioUrl ?? null,
        emotion: cp.emotion ?? "neutral",
        crowd: typeof cp.crowd === "number" ? cp.crowd : 0.3,
      };
      break;
    }
    case "error": {
      const er = p as ErrorP;
      n.feedRed = pushFeed(n.feedRed, { id: ev.id, ts: ev.ts, agent: ev.agent, kind: "error", text: `× ${er.tool}`, sub: er.msg });
      break;
    }
  }
  return n;
}
