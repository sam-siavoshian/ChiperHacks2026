// GET /api/stream — Server-Sent Events feed for the browser. On connect it
// replays the current ring buffer (so a TV opened mid-match rebuilds full state),
// then streams every new event live. Keepalive comments hold the connection open
// through proxies. Cleans up its subscriber on disconnect.

import { NextRequest } from "next/server";
import { subscribe } from "@/lib/hub";
import type { AnyEvent } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (ev: AnyEvent) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)); }
        catch { /* controller already torn down */ }
      };

      // replay buffer + attach to live feed
      const unsub = subscribe(send, true);

      // initial comment so the browser fires `onopen` promptly
      controller.enqueue(enc.encode(`: connected\n\n`));

      const keepalive = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(enc.encode(`: ping\n\n`)); } catch { /* ignore */ }
      }, 15000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsub();
        try { controller.close(); } catch { /* ignore */ }
      };

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
