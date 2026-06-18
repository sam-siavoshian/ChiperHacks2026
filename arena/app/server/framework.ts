// Minimal Express-compatible HTTP layer on top of Bun.serve.
// Supports routers, nesting, params, middleware, json/cookies — enough for Tasklight.

export interface Request {
  method: string;
  path: string;
  originalUrl: string;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  cookies: Record<string, string>;
  body: any;
  [key: string]: any;
}

export interface Response {
  status(code: number): Response;
  json(payload: any): Response;
  send(body: any): Response;
  set(key: string, value: string): Response;
  cookie(name: string, value: string, opts?: Record<string, any>): Response;
  clearCookie(name: string): Response;
  redirect(url: string): Response;
  sendFile(path: string, cb?: (err?: any) => void): Response;
  headersSent: boolean;
  finished: boolean;
}

export type NextFunction = (err?: any) => void;
export type Handler = (req: Request, res: Response, next: NextFunction) => any;
type ErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => any;

interface Layer {
  kind: "use" | "route" | "mount" | "error";
  method?: string;
  prefix: string;
  regex?: RegExp;
  keys: string[];
  handlers: Handler[];
  router?: RouterBase;
  errorHandler?: ErrorHandler;
}

function compile(path: string, exact: boolean): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const pattern = path
    .replace(/\/+$/, "")
    .replace(/:([A-Za-z0-9_]+)/g, (_m, k) => {
      keys.push(k);
      return "([^/]+)";
    });
  const suffix = exact ? "/?$" : "(?=/|$)";
  return { regex: new RegExp("^" + (pattern || "") + suffix), keys };
}

export class RouterBase {
  layers: Layer[] = [];

  use(pathOrHandler: string | Handler | Router, ...rest: (Handler | Router)[]) {
    let prefix = "/";
    let items: (Handler | Router)[];
    if (typeof pathOrHandler === "string") {
      prefix = pathOrHandler;
      items = rest;
    } else {
      items = [pathOrHandler, ...rest];
    }
    for (const item of items) {
      if (item instanceof RouterBase) {
        const { regex, keys } = compile(prefix, false);
        this.layers.push({ kind: "mount", prefix, regex, keys, handlers: [], router: item });
      } else if (item.length === 4) {
        this.layers.push({ kind: "error", prefix, keys: [], handlers: [], errorHandler: item as ErrorHandler });
      } else {
        const { regex, keys } = compile(prefix, false);
        this.layers.push({ kind: "use", prefix, regex, keys, handlers: [item as Handler] });
      }
    }
    return this;
  }

  private add(method: string, path: string, handlers: Handler[]) {
    const { regex, keys } = compile(path, true);
    this.layers.push({ kind: "route", method, prefix: path, regex, keys, handlers });
  }
  get(path: string, ...h: Handler[]) { this.add("GET", path, h); return this; }
  post(path: string, ...h: Handler[]) { this.add("POST", path, h); return this; }
  patch(path: string, ...h: Handler[]) { this.add("PATCH", path, h); return this; }
  put(path: string, ...h: Handler[]) { this.add("PUT", path, h); return this; }
  delete(path: string, ...h: Handler[]) { this.add("DELETE", path, h); return this; }

  async handle(req: Request, res: Response, remaining: string, baseParams: Record<string, string>): Promise<boolean> {
    for (const layer of this.layers) {
      if (res.finished) return true;
      if (layer.kind === "error") continue;
      const m = layer.regex!.exec(remaining);
      if (!m) continue;
      const params = { ...baseParams };
      layer.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? "")));

      if (layer.kind === "route") {
        if (layer.method !== req.method) continue;
        req.params = params;
        const ok = await this.runChain(layer.handlers, req, res);
        if (!ok && !res.finished) continue;
        return true;
      }
      if (layer.kind === "use") {
        req.params = params;
        let advanced = false;
        let chainErr: any = null;
        await new Promise<void>((resolve) => {
          const next = (err?: any) => { if (err) chainErr = err; advanced = true; resolve(); };
          try {
            Promise.resolve(layer.handlers[0](req, res, next))
              .then(() => resolve())
              .catch((e) => { chainErr = e; resolve(); });
          } catch (e) { chainErr = e; resolve(); }
        });
        if (chainErr) throw chainErr;
        if (res.finished) return true;
        if (!advanced) return true; // middleware ended without next()
        continue;
      }
      if (layer.kind === "mount") {
        const stripped = remaining.replace(layer.regex!, "") || "/";
        const childRemaining = stripped.startsWith("/") ? stripped : "/" + stripped;
        req.params = params;
        const handled = await layer.router!.handle(req, res, childRemaining, params);
        if (handled) return true;
      }
    }
    return false;
  }

  private async runChain(handlers: Handler[], req: Request, res: Response): Promise<boolean> {
    for (const h of handlers) {
      let advanced = false;
      let err: any = null;
      await new Promise<void>((resolve) => {
        const next = (e?: any) => { if (e) err = e; advanced = true; resolve(); };
        try { Promise.resolve(h(req, res, next)).then(() => resolve()).catch((e) => { err = e; resolve(); }); }
        catch (e) { err = e; resolve(); }
      });
      if (err) throw err;
      if (res.finished) return true;
      if (!advanced) return true;
    }
    return true;
  }

  errorHandlers(): ErrorHandler[] {
    return this.layers.filter((l) => l.kind === "error").map((l) => l.errorHandler!);
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function Router(): RouterBase {
  return new RouterBase();
}

export class Application extends RouterBase {
  async dispatch(raw: globalThis.Request): Promise<globalThis.Response> {
    const url = new URL(raw.url);
    const headers: Record<string, string | undefined> = {};
    raw.headers.forEach((v, k) => (headers[k] = v));
    const query: Record<string, string | undefined> = {};
    url.searchParams.forEach((v, k) => { if (!(k in query)) query[k] = v; });

    let body: any = undefined;
    if (raw.method !== "GET" && raw.method !== "HEAD") {
      const ct = headers["content-type"] ?? "";
      if (ct.includes("application/json")) {
        try { body = await raw.json(); } catch { body = {}; }
      } else if (ct.includes("application/x-www-form-urlencoded")) {
        body = Object.fromEntries(new URLSearchParams(await raw.text()));
      } else {
        try { body = await raw.text(); } catch { body = undefined; }
      }
    }

    const req: Request = {
      method: raw.method,
      path: url.pathname,
      originalUrl: url.pathname + url.search,
      params: {},
      query,
      headers,
      cookies: parseCookies(headers["cookie"]),
      body: body ?? {},
    };

    let statusCode = 200;
    const outHeaders = new Headers();
    let payload: BodyInit | null = null;
    const state = { finished: false, headersSent: false };

    const res: Response = {
      headersSent: false,
      finished: false,
      status(code) { statusCode = code; return res; },
      json(p) { outHeaders.set("content-type", "application/json"); payload = JSON.stringify(p); state.finished = true; res.finished = true; return res; },
      send(b) {
        if (b instanceof Uint8Array || b instanceof ArrayBuffer) payload = b as any;
        else if (typeof b === "string") payload = b;
        else { outHeaders.set("content-type", "application/json"); payload = JSON.stringify(b); }
        state.finished = true; res.finished = true; return res;
      },
      set(k, v) { outHeaders.set(k, v); return res; },
      cookie(name, value, opts = {}) {
        let c = `${name}=${encodeURIComponent(value)}; Path=/`;
        if (opts.httpOnly) c += "; HttpOnly";
        if (opts.sameSite) c += `; SameSite=${opts.sameSite}`;
        outHeaders.append("set-cookie", c);
        return res;
      },
      clearCookie(name) { outHeaders.append("set-cookie", `${name}=; Path=/; Max-Age=0`); return res; },
      redirect(loc) { statusCode = 302; outHeaders.set("location", loc); state.finished = true; res.finished = true; return res; },
      sendFile(path, cb) {
        try {
          const file = Bun.file(path);
          payload = file as any;
          state.finished = true; res.finished = true;
          cb?.();
        } catch (e) { cb?.(e); }
        return res;
      },
    };

    try {
      const handled = await this.handle(req, res, url.pathname.replace(/\/+$/, "") || "/", {});
      if (!handled && !res.finished) { statusCode = 404; outHeaders.set("content-type", "application/json"); payload = JSON.stringify({ error: "not found" }); }
    } catch (err: any) {
      const eh = this.errorHandlers();
      if (eh.length) {
        await new Promise<void>((resolve) => { try { Promise.resolve(eh[0](err, req, res, () => resolve())).then(() => resolve()).catch(() => resolve()); } catch { resolve(); } });
        if (!res.finished) { statusCode = 500; payload = JSON.stringify({ error: "internal server error" }); }
      } else {
        statusCode = 500; outHeaders.set("content-type", "application/json"); payload = JSON.stringify({ error: "internal server error", message: err?.message });
      }
    }

    return new globalThis.Response(payload, { status: statusCode, headers: outHeaders });
  }
}

export function express() { return new Application(); }
express.json = () => ((_req: Request, _res: Response, next: NextFunction) => next());
express.static = (root: string) => async (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET") return next();
  const rel = req.path === "/" ? "/index.html" : req.path;
  const file = Bun.file(root + rel);
  if (await file.exists()) {
    res.set("content-type", file.type || "application/octet-stream");
    res.send(new Uint8Array(await file.arrayBuffer()));
  } else {
    next();
  }
};
export default express;
