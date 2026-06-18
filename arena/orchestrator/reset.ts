// Owns the live Tasklight instance the agents fight over, plus the per-turn
// "full reset": restore source + data to pristine, restart. The board's score
// lives elsewhere (board.ts) and survives this.

import { $, spawn } from "bun";
import { resolve } from "path";
import { existsSync, rmSync, copyFileSync } from "fs";

const APP_DIR = resolve(import.meta.dir, "../app");
const PRISTINE = resolve(import.meta.dir, "../.pristine/app");
const SEED_DB = resolve(APP_DIR, "seed/seed.db");
const LIVE_DB = resolve(APP_DIR, "tasklight.db");
const UPLOADS = resolve(APP_DIR, "uploads");

export class AppController {
  proc: ReturnType<typeof spawn> | null = null;
  port: number;

  constructor(port = 4000) {
    this.port = port;
  }

  get base() {
    return `http://127.0.0.1:${this.port}`;
  }

  // Capture an immutable baseline of the patchable source + uploads + seed db.
  async snapshotPristine() {
    await $`rm -rf ${PRISTINE}`.quiet();
    await $`mkdir -p ${PRISTINE}`.quiet();
    await $`cp -R ${resolve(APP_DIR, "server")} ${PRISTINE}/server`.quiet();
    await $`cp -R ${UPLOADS} ${PRISTINE}/uploads`.quiet();
    await $`cp ${SEED_DB} ${PRISTINE}/seed.db`.quiet();
  }

  private ensureSeed() {
    if (!existsSync(SEED_DB)) {
      Bun.spawnSync({ cmd: ["bun", "run", "seed/seed.ts"], cwd: APP_DIR, env: { ...process.env, DB_PATH: SEED_DB } });
    }
  }

  private freshDb() {
    for (const s of ["", "-wal", "-shm"]) rmSync(LIVE_DB + s, { force: true });
    copyFileSync(SEED_DB, LIVE_DB);
  }

  private async waitHealth(ms = 8000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${this.base}/api/health`)).ok) return;
      } catch {}
      await Bun.sleep(80);
    }
    throw new Error("app did not become healthy");
  }

  async start() {
    this.ensureSeed();
    this.freshDb();
    this.proc = spawn({
      cmd: ["bun", "run", "server/index.ts"],
      cwd: APP_DIR,
      env: { ...process.env, DB_PATH: LIVE_DB, PORT: String(this.port), HOST: "127.0.0.1", NODE_ENV: "development" },
      stdout: "pipe",
      stderr: "pipe",
    });
    await this.waitHealth();
  }

  async stop() {
    if (this.proc) {
      this.proc.kill();
      await this.proc.exited;
      this.proc = null;
    }
  }

  // Reload the (possibly edited) source with fresh data, without touching source.
  async restart() {
    await this.stop();
    await this.start();
  }

  // Unified diff of the defender's edits vs the pristine baseline (for the judge).
  async diffAgainstPristine(): Promise<string> {
    const out = await $`diff -ruN ${PRISTINE}/server ${resolve(APP_DIR, "server")}`.quiet().nothrow();
    return out.stdout.toString();
  }

  // Full reset to pristine: restore source + uploads + data, restart.
  async resetToPristine() {
    await this.stop();
    await $`rm -rf ${resolve(APP_DIR, "server")}`.quiet();
    await $`cp -R ${PRISTINE}/server ${resolve(APP_DIR, "server")}`.quiet();
    await $`rm -rf ${UPLOADS}`.quiet();
    await $`cp -R ${PRISTINE}/uploads ${UPLOADS}`.quiet();
    copyFileSync(`${PRISTINE}/seed.db`, SEED_DB);
    await this.start();
  }
}
