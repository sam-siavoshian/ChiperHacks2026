// The persistent match board: 20 vulns (+ decoys). Each is contested once.
// Red claims by exploiting, Blue claims by patching. Claimed -> off the board.
// This is the score's source of truth and survives the per-turn app reset.

import manifest from "../contract/vuln-manifest.json";

export type CellStatus = "open" | "red_scored" | "blue_saved";

export interface Cell {
  id: string;
  title: string;
  area: string;
  difficulty: string;
  isDecoy: boolean;
  status: CellStatus;
}

const POINTS: Record<string, number> = { easy: 1, medium: 2, hard: 3 };

export class Board {
  cells = new Map<string, Cell>();
  red = 0;
  blue = 0;

  constructor() {
    for (const n of (manifest as any).nodes as any[]) {
      this.cells.set(n.id, {
        id: n.id,
        title: n.title,
        area: n.area,
        difficulty: n.difficulty,
        isDecoy: !!n.isDecoy,
        status: "open",
      });
    }
  }

  get(id: string): Cell | undefined {
    return this.cells.get(id);
  }

  list(): Cell[] {
    return [...this.cells.values()];
  }

  private points(id: string): number {
    return POINTS[this.cells.get(id)?.difficulty ?? "medium"] ?? 2;
  }

  // Red exploited a real vuln. Returns true if it newly scored.
  claimRed(id: string): boolean {
    const c = this.cells.get(id);
    if (!c || c.isDecoy || c.status !== "open") return false;
    c.status = "red_scored";
    this.red += this.points(id);
    return true;
  }

  // Blue patched a real vuln before Red got it.
  claimBlue(id: string): boolean {
    const c = this.cells.get(id);
    if (!c || c.isDecoy || c.status !== "open") return false;
    c.status = "blue_saved";
    this.blue += this.points(id);
    return true;
  }

  // Bad patch: Blue is docked a point (floored at 0). Board stays open.
  penalizeBlue(): void {
    this.blue = Math.max(0, this.blue - 1);
  }

  openRealVulns(): Cell[] {
    return this.list().filter((c) => !c.isDecoy && c.status === "open");
  }

  isOver(): boolean {
    return this.openRealVulns().length === 0;
  }

  winner(): "red" | "blue" | "draw" {
    if (this.red > this.blue) return "red";
    if (this.blue > this.red) return "blue";
    return "draw";
  }

  snapshot() {
    return {
      red: this.red,
      blue: this.blue,
      cells: this.list().map((c) => ({ id: c.id, status: c.status, isDecoy: c.isDecoy, area: c.area, difficulty: c.difficulty })),
    };
  }
}
