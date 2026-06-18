import { resolve } from "path";

// Centralised runtime configuration for the Tasklight API.
export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "127.0.0.1",
  env: process.env.NODE_ENV ?? "development",
  dbPath: process.env.DB_PATH ?? resolve(import.meta.dir, "../tasklight.db"),
  uploadDir: process.env.UPLOAD_DIR ?? resolve(import.meta.dir, "../uploads"),
  // JWT signing material. Override via env in production deployments.
  jwtSecret: process.env.JWT_SECRET ?? "tasklight-secret",
  jwtIssuer: "tasklight",
  tokenTtlSeconds: 60 * 60 * 24 * 7,
  appName: "Tasklight",
  appUrl: process.env.APP_URL ?? "http://127.0.0.1:4000",
  integrationTimeoutMs: 4000,
};

export type Config = typeof config;
