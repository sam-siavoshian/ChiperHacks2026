import { mkdirSync } from "fs";
import { resolve } from "path";
import express from "./framework";
import { config } from "./config";
import { migrate } from "./db";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { workspacesRouter } from "./routes/workspaces";
import { tasksRouter } from "./routes/tasks";
import { searchRouter } from "./routes/search";
import { reportsRouter } from "./routes/reports";
import { filesRouter } from "./routes/files";
import { billingRouter } from "./routes/billing";
import { integrationsRouter } from "./routes/integrations";
import { adminRouter } from "./routes/admin";
import { miscRouter } from "./routes/misc";

mkdirSync(config.uploadDir, { recursive: true });
migrate();

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true, name: config.appName }));

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/workspaces", workspacesRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/search", searchRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/files", filesRouter);
app.use("/api/billing", billingRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/admin", adminRouter);
app.use("/api", miscRouter);

// Marketing landing at "/", the app SPA at "/app" (+ static assets).
const webDir = resolve(import.meta.dir, "../web");
app.get("/", (_req, res) => {
  res.set("content-type", "text/html");
  res.sendFile(`${webDir}/landing.html`);
});
app.use(express.static(webDir));
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.set("content-type", "text/html");
  res.sendFile(`${webDir}/index.html`);
});

// Error handler.
app.use((err: any, req: any, res: any, _next: any) => {
  res.status(500).json({
    error: "internal server error",
    message: err?.message,
    stack: config.env === "production" ? undefined : err?.stack,
    path: req.path,
  });
});

Bun.serve({
  port: config.port,
  hostname: config.host,
  idleTimeout: 30,
  fetch: (req) => app.dispatch(req),
});

console.log(`Tasklight API listening on http://${config.host}:${config.port}`);
