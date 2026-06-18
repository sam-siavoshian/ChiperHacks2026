"""Narrator service — the inline relay between the arena and the TV broadcast.

  arena  ──POST /emit──▶  narrator :8790  ──POST──▶  TV /api/events
                              │
                              ├─ feeds every event into the commentary engine
                              ├─ forwards gameplay events to the TV instantly
                              ├─ suppresses the arena's raw commentary (the engine
                              │  owns the voice channel) — unless no keys, then it
                              │  relays everything untouched
                              └─ serves the generated voice clips at /audio/<id>.mp3

Run:  python -m narrator.server
Wire: set the arena's  ARENA_BUS_EMIT=http://127.0.0.1:8790/emit
      set the TV's      NARRATOR_WARMUP_URL=http://127.0.0.1:8790/warmup
"""

import asyncio

from aiohttp import ClientSession, ClientTimeout, web

from . import config
from .engine import CommentaryEngine

_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, x-ingest-token, range",
}


def _events_from(body):
    if isinstance(body, list):
        return [e for e in body if isinstance(e, dict)]
    if isinstance(body, dict):
        return [body]
    return []


class Narrator:
    def __init__(self):
        self.session: ClientSession | None = None
        self.engine = CommentaryEngine(forward=self._forward_tv)

    async def _forward_tv(self, env: dict) -> None:
        """Ship one envelope to the TV ingest. Best-effort; never raises."""
        if self.session is None:
            return
        try:
            await self.session.post(config.TV_EVENTS_URL, json=env)
        except Exception:
            pass

    # -- HTTP handlers ------------------------------------------------------
    async def handle_emit(self, req: web.Request) -> web.Response:
        try:
            body = await req.json()
        except Exception:
            return web.json_response({"ok": False, "error": "invalid json"}, status=400, headers=_CORS)

        # control messages (e.g. {control:"reset"}) just pass straight through
        if isinstance(body, dict) and body.get("control"):
            await self._forward_tv(body)
            return web.json_response({"ok": True, "control": body.get("control")}, headers=_CORS)

        events = _events_from(body)
        forwarded = 0
        for env in events:
            self.engine.ingest(env)
            if env.get("type") == "commentary" and self.engine.owns_commentary:
                continue  # the engine voices its own commentary channel
            await self._forward_tv(env)
            forwarded += 1
        return web.json_response({"ok": True, "received": len(events), "forwarded": forwarded}, headers=_CORS)

    async def handle_audio(self, req: web.Request) -> web.Response:
        cid = req.match_info.get("cid", "")
        audio = self.engine.clips.get(cid)
        if not audio:
            return web.Response(status=404, headers=_CORS)
        total = len(audio)
        headers = {**_CORS, "Accept-Ranges": "bytes", "Cache-Control": "no-store"}
        rng = req.headers.get("Range")
        if rng and rng.startswith("bytes="):
            try:
                start_s, end_s = rng[6:].split("-", 1)
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else total - 1
                start = max(0, start)
                end = min(total - 1, end)
                if start > end:
                    raise ValueError
            except ValueError:
                return web.Response(status=416, headers={**headers, "Content-Range": f"bytes */{total}"})
            chunk = audio[start : end + 1]
            headers["Content-Range"] = f"bytes {start}-{end}/{total}"
            return web.Response(status=206, body=chunk, content_type="audio/mpeg", headers=headers)
        return web.Response(status=200, body=audio, content_type="audio/mpeg", headers=headers)

    async def handle_warmup(self, req: web.Request) -> web.Response:
        try:
            cfg = await req.json()
        except Exception:
            cfg = {}
        red, blue = cfg.get("red") or {}, cfg.get("blue") or {}
        if red.get("model") or blue.get("model"):
            self.engine.set_meta(f"RED is {red.get('model','?')}, BLUE is {blue.get('model','?')}.")
        # prime the TTS socket + the LLM connection so the first real line at
        # kickoff doesn't eat a cold-start latency.
        if config.tts_enabled():
            asyncio.create_task(self._prime_tts())
        if config.llm_enabled():
            asyncio.create_task(self._prime_llm())
        return web.json_response({
            "ok": True,
            "llm": config.llm_enabled(),
            "tts": config.tts_enabled(),
            "model": config.NARRATOR_MODEL if config.llm_enabled() else None,
        }, headers=_CORS)

    async def _prime_tts(self):
        try:
            from . import tts
            await tts.synthesize("Welcome to the Arena.")
        except Exception:
            pass

    async def _prime_llm(self):
        try:
            from . import llm
            await llm.next_line(state_summary="Pre-match warmup.", new_action="", recent_lines=[])
        except Exception:
            pass

    async def handle_health(self, req: web.Request) -> web.Response:
        return web.json_response({
            "ok": True,
            "live": self.engine.live,
            "active": self.engine.active,
            "llm": config.llm_enabled(),
            "tts": config.tts_enabled(),
            "clips": len(self.engine.clips),
            "round": self.engine.round,
            "score": {"red": self.engine.red, "blue": self.engine.blue},
        }, headers=_CORS)

    async def handle_options(self, req: web.Request) -> web.Response:
        return web.Response(status=204, headers=_CORS)

    # -- lifecycle ----------------------------------------------------------
    async def on_startup(self, app):
        self.session = ClientSession(timeout=ClientTimeout(total=5))
        self.engine.start()

    async def on_cleanup(self, app):
        await self.engine.stop()
        if self.session:
            await self.session.close()


def build_app() -> web.Application:
    n = Narrator()
    app = web.Application(client_max_size=2 * 1024 * 1024)
    app.add_routes([
        web.post("/emit", n.handle_emit),
        web.get("/audio/{cid}.mp3", n.handle_audio),
        web.post("/warmup", n.handle_warmup),
        web.get("/healthz", n.handle_health),
        web.options("/{tail:.*}", n.handle_options),
    ])
    app.on_startup.append(n.on_startup)
    app.on_cleanup.append(n.on_cleanup)
    app["narrator"] = n
    return app


def main():
    mode = ("LLM+TTS" if config.llm_enabled() and config.tts_enabled()
            else "LLM-only (captions)" if config.llm_enabled()
            else "TTS-only (voices arena beats)" if config.tts_enabled()
            else "passthrough relay (no keys)")
    print(f"[narrator] mode: {mode}")
    print(f"[narrator] listening on http://{config.LISTEN_HOST}:{config.LISTEN_PORT}  ->  {config.TV_EVENTS_URL}")
    print(f"[narrator] audio served from {config.PUBLIC_URL}/audio/<id>.mp3")
    if config.llm_enabled():
        print(f"[narrator] play-by-play model: {config.NARRATOR_MODEL}")
    else:
        print("[narrator] OPENAI_API_KEY not set — continuous play-by-play disabled.")
    web.run_app(build_app(), host=config.LISTEN_HOST, port=config.LISTEN_PORT, print=None)


if __name__ == "__main__":
    main()
