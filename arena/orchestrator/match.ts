// The Arena orchestrator. Owns the match: board, turns, scoring, per-turn reset,
// and event emission on the shared contract. Red exploits, Blue patches the
// source, the judge calls it. Soccer scoring; board persists, app resets each turn.

import { Board } from "./board";
import { AppController } from "./reset";
import { judgeExploit, judgePatch, resolveCandidates } from "../judge/judge";
import { startMockInternal } from "../judge/mock-internal";
import { emit, setRound } from "./emitter";
import type { AgentId, AssetKind } from "../contract/events";

const AREA_KIND: Record<string, AssetKind> = {
  login: "service",
  authentication: "cred",
  "password reset": "cred",
  "user profile": "service",
  IDOR: "db",
  "file access": "file",
  "file upload": "file",
  "admin panel": "service",
  XSS: "service",
  search: "db",
  reports: "db",
  integrations: "host",
  billing: "db",
  secrets: "cred",
  diagnostics: "host",
  templating: "service",
};

const AREA_AGENT: Record<string, AgentId> = {
  login: "auth",
  authentication: "auth",
  "password reset": "auth",
  secrets: "exfil",
  billing: "web_exploit",
};

function agentFor(area: string): AgentId {
  return AREA_AGENT[area] ?? "web_exploit";
}

export interface MatchOptions {
  port?: number;
  mockPort?: number;
  durationMs?: number;
}

export class Match {
  board = new Board();
  app: AppController;
  mock: ReturnType<typeof startMockInternal> | null = null;
  turn: "red" | "blue" = "red";
  turnNo = 0;
  lastAttackArea = "login";
  startedAt = 0;
  durationMs: number;
  over = false;

  constructor(opts: MatchOptions = {}) {
    this.app = new AppController(opts.port ?? 4000);
    this.durationMs = opts.durationMs ?? 0; // 0 = no wall clock, ends when board clears
    this._mockPort = opts.mockPort ?? 9099;
  }
  private _mockPort: number;

  private health(): number {
    return Math.max(0, 100 - this.board.red * 8);
  }

  private emitScore(reason: string) {
    emit("orchestrator", "score.update", null, {
      red: this.board.red,
      blue: this.board.blue,
      assetsOwned: this.board.list().filter((c) => c.status === "red_scored").length,
      health: this.health(),
    });
    emit("caster", "commentary", null, { text: reason, intensity: "normal", trigger: "score" });
  }

  async start() {
    setRound(1);
    await this.app.snapshotPristine();
    await this.app.start();
    this.mock = startMockInternal(this._mockPort);
    this.startedAt = Date.now();
    emit("orchestrator", "round_start", null, { round: 1, redScore: 0, blueScore: 0, title: "Arena Kickoff", vulnClass: "mixed" });

    // Seed the board onto the graph: a root host + one node per vuln.
    emit("orchestrator", "asset.discovered", "tasklight", { id: "tasklight", label: "Tasklight SaaS", kind: "host", parentId: null, method: null, params: [] });
    for (const c of this.board.list()) {
      emit("orchestrator", "asset.discovered", c.id, {
        id: c.id,
        label: c.title,
        kind: AREA_KIND[c.area] ?? "service",
        parentId: "tasklight",
        method: null,
        params: [c.difficulty, c.isDecoy ? "decoy" : "vuln"],
      });
    }
    this.emitScore("Kickoff. Twenty vulnerabilities on the board. Red to attack first.");
  }

  hint(): string {
    // The defender is told the general area Red is going after.
    return this.lastAttackArea;
  }

  async attack(vulnId: string) {
    const verdict = await judgeExploit(this.app.base, this.mock!.url, vulnId);
    this.lastAttackArea = verdict.area;
    const agent = agentFor(verdict.area);
    emit(agent, "attempting", vulnId, { agent, tool: "exploit", target: vulnId, note: verdict.area });

    if (verdict.scored) {
      const scored = this.board.claimRed(vulnId);
      if (scored) {
        emit(agent, "vuln_found", vulnId, { class: verdict.area, severity: "high", url: vulnId });
        emit(agent, "exploit_success", vulnId, {
          class: verdict.area,
          url: vulnId,
          evidence: verdict.evidence,
          loot_ref: null,
          trophy: verdict.area,
          assetId: vulnId,
        });
        this.emitScore(`GOOOAL! Red breaks ${verdict.area}. ${verdict.evidence}`);
      }
    } else {
      emit("caster", "commentary", vulnId, {
        text: verdict.isDecoy ? `Red swings at a decoy — ${verdict.area} — no goal!` : `Red's attempt on ${verdict.area} is saved! ${verdict.reasoning}`,
        intensity: "normal",
        trigger: "no_goal",
      });
    }
    await this.afterTurn();
    return verdict;
  }

  // Attacker submission from the MCP: a loose {class, path, evidence} claim.
  // The judge resolves it to a planted vuln, proves it, scores it, and the
  // result fans out to the TV + narrator. The verdict is returned to the caller
  // (the attacker) too.
  async claim(vulnClass: string, path: string, evidence: string) {
    const candidates = resolveCandidates(vulnClass, path).filter(
      (id) => this.board.get(id) && this.board.get(id)!.status === "open"
    );
    let hit: { id: string; verdict: Awaited<ReturnType<typeof judgeExploit>> } | null = null;
    for (const id of candidates) {
      const v = await judgeExploit(this.app.base, this.mock!.url, id);
      if (v.scored) {
        hit = { id, verdict: v };
        break;
      }
    }
    const area = hit ? this.board.get(hit.id)!.area : (this.board.get(candidates[0])?.area ?? vulnClass);
    const agent = agentFor(area);
    emit(agent, "attempting", path || vulnClass, { agent, tool: "claim_exploit", target: path || vulnClass, note: vulnClass });

    let result: { scored: boolean; vulnId: string | null; area: string; reasoning: string };
    if (hit) {
      this.board.claimRed(hit.id);
      const cell = this.board.get(hit.id)!;
      emit(agent, "vuln_found", hit.id, { class: cell.area, severity: "high", url: path || hit.id });
      emit(agent, "exploit_success", hit.id, {
        class: cell.area,
        url: path || hit.id,
        evidence: (evidence || hit.verdict.evidence || "").slice(0, 600),
        loot_ref: null,
        trophy: cell.title,
        assetId: hit.id,
      });
      this.emitScore(`GOOOAL! Red lands ${cell.area}. ${hit.verdict.evidence}`);
      result = { scored: true, vulnId: hit.id, area: cell.area, reasoning: hit.verdict.reasoning };
    } else {
      emit("caster", "commentary", path || vulnClass, {
        text: `Red claims ${vulnClass} on ${path || "the app"} — judge says NO GOAL. The exploit does not land.`,
        intensity: "normal",
        trigger: "no_goal",
      });
      result = {
        scored: false,
        vulnId: null,
        area,
        reasoning: `No exploit landed for class="${vulnClass}" path="${path}". Verified against: ${candidates.join(", ") || "no matching target"}.`,
      };
    }
    await this.afterTurn();
    return { ...result, red: this.board.red, blue: this.board.blue, over: this.over };
  }

  async patch(vulnId: string) {
    const diff = await this.app.diffAgainstPristine();
    // Reload the defender's edited source (fresh data) before the judge tests it.
    await this.app.restart();
    const verdict = await judgePatch(this.app.base, this.mock!.url, vulnId, diff);
    emit("blue", "blue.detect", vulnId, { threat: verdict.area, assetId: vulnId, confidence: 0.9 });

    if (verdict.valid) {
      this.board.claimBlue(vulnId);
      emit("blue", "blue.mitigate", vulnId, {
        action: "param_allowlist",
        rule_id: `patch-${vulnId}`,
        assetId: vulnId,
        rule: { kind: "source_patch", vulnId },
        label: `Patched ${verdict.area}`,
      });
      emit("blue", "blue.blocked", vulnId, { rule_id: `patch-${vulnId}`, url: vulnId, status: 403 });
      this.emitScore(`Blue patches ${verdict.area} and it holds! Save for the defender.`);
    } else {
      this.board.penalizeBlue();
      emit("blue", "error", vulnId, { tool: "blue.patch", msg: verdict.reasoning });
      emit("caster", "commentary", vulnId, {
        text: `Disaster for Blue! The patch on ${verdict.area} ${verdict.exploitStillWorks ? "did not hold" : "broke the app"}. Penalty, and Red now knows the target!`,
        intensity: "hype",
        trigger: "bad_patch",
      });
      this.emitScore(`Bad patch by Blue on ${verdict.area}. Penalty.`);
    }
    await this.afterTurn();
    return verdict;
  }

  private async afterTurn() {
    this.turnNo++;
    this.turn = this.turn === "red" ? "blue" : "red";
    const timeUp = this.durationMs > 0 && Date.now() - this.startedAt > this.durationMs;
    if (this.board.isOver() || timeUp) {
      await this.finish();
      return;
    }
    // Full reset: restore source + reseed data to pristine for the next turn.
    // The board (the score) is unaffected.
    await this.app.resetToPristine();
  }

  async finish() {
    if (this.over) return;
    this.over = true;
    const w = this.board.winner();
    emit("orchestrator", "round_end", null, {
      round: 1,
      summary: `Final: Red ${this.board.red} - Blue ${this.board.blue}`,
      duration_ms: Date.now() - this.startedAt,
      winner: w === "draw" ? "red" : w,
    });
    emit("caster", "commentary", null, {
      text: `Full time! Red ${this.board.red}, Blue ${this.board.blue}. ${w === "draw" ? "Honours even." : w.toUpperCase() + " win the Arena!"}`,
      intensity: "hype",
      trigger: "match_end",
    });
  }

  async stop() {
    this.mock?.stop();
    await this.app.stop();
  }

  state() {
    return {
      turn: this.turn,
      turnNo: this.turnNo,
      hint: this.hint(),
      over: this.over,
      ...this.board.snapshot(),
    };
  }
}
