import { spawnSync, spawn } from "bun";
import { existsSync, copyFileSync, rmSync } from "fs";
import { resolve } from "path";
import { startMockInternal } from "./mock-internal";

const APP_DIR = resolve(import.meta.dir, "../app");
const SEED_DB = resolve(APP_DIR, "seed/seed.db");

export interface Arena {
  base: string;
  internalUrl: string;
  proc: ReturnType<typeof spawn>;
  stop: () => Promise<void>;
}

function ensureSeed() {
  if (!existsSync(SEED_DB)) {
    spawnSync({
      cmd: ["bun", "run", "seed/seed.ts"],
      cwd: APP_DIR,
      env: { ...process.env, DB_PATH: SEED_DB },
    });
  }
}

async function waitForHealth(base: string, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return true;
    } catch {}
    await Bun.sleep(80);
  }
  throw new Error("arena did not become healthy in time");
}

// Boot a fresh, pristine, seeded instance of the Tasklight app on its own port + db.
export async function startArena(opts: { port?: number; mockPort?: number } = {}): Promise<Arena> {
  const port = opts.port ?? 4055;
  const mockPort = opts.mockPort ?? 9099;
  ensureSeed();
  const dbPath = resolve(APP_DIR, `arena-run-${port}.db`);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
  copyFileSync(SEED_DB, dbPath);

  const proc = spawn({
    cmd: ["bun", "run", "server/index.ts"],
    cwd: APP_DIR,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "development" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base);
  const mock = startMockInternal(mockPort);

  return {
    base,
    internalUrl: mock.url,
    proc,
    stop: async () => {
      mock.stop();
      proc.kill();
      await proc.exited;
      for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
    },
  };
}
