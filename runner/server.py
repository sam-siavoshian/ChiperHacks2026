"""Match runner as an HTTP service — so the match starts from the frontend.

The TV's LAUNCH button POSTs here (via the TV's /api/match/start route). This boots
the control plane + MCPs once, then runs each match in the background: spawning the
RED and BLUE Claude Code sessions, driving the turns, and emitting to the TV. Set
ARENA_MOCK_AGENTS=1 to run real exploits/patches with scripted agents (no model
tokens) — handy for demoing the whole pipeline from the dashboard.

Run:  python -m runner.server          (listens on :8799)
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import time
from typing import Any, Optional

import httpx
from aiohttp import web

from .config import Config
from .match import MatchRunner
from .processes import ProcManager
from .session import AgentSession

MOCK = os.environ.get("ARENA_MOCK_AGENTS", "0") not in ("0", "", "false")
_DEFAULT_CLAUDE = "claude-opus-4-8"


def _claude_model(m: str) -> str:
    """The agents are the claude CLI (Anthropic only). Keep claude-* picks (opus /
    sonnet / haiku) as chosen; fall back to opus for anything else so a non-Anthropic
    pick can never break the match."""
    m = (m or "").strip()
    return m if m.startswith("claude-") else _DEFAULT_CLAUDE


class Service:
    def __init__(self) -> None:
        self.cfg = Config()
        self.cfg.start_mcps = False  # sessions spawn their own STDIO MCP per turn
        self.procs = ProcManager(self.cfg)
        self._http: Optional[httpx.AsyncClient] = None
        self.task: Optional[asyncio.Task] = None
        self.started_at = 0
        self.last_result: dict[str, Any] = {}
        self.booted = False

    async def http(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=20.0)
        return self._http

    async def _route_through_narrator(self) -> None:
        """If the narrator (:8790) is up, send the match's events through it so it
        can speak live play-by-play and forward to the TV. If it is down, fall back
        to emitting straight to the TV — the broadcast still works, just silent.
        Honors an explicit ARENA_BUS override (don't auto-rewrite a deliberate one)."""
        if os.environ.get("ARENA_BUS"):
            return  # operator pinned the bus; respect it
        narrator = os.environ.get("ARENA_NARRATOR", "http://127.0.0.1:8790")
        try:
            # /emit is POST-only; a GET returns 405 but proves the port is listening.
            await (await self.http()).get(narrator, timeout=1.5)
            up = True
        except Exception:
            up = False
        if up:
            self.cfg.bus, self.cfg.bus_emit_path = narrator, "/emit"
        else:
            self.cfg.bus, self.cfg.bus_emit_path = "http://127.0.0.1:3100", "/api/events"

    async def _reset_tv(self) -> None:
        # Wipe the TV buffer directly (the narrator relay drops control messages),
        # so every match starts from a clean board.
        tv = os.environ.get("ARENA_TV_EVENTS", "http://127.0.0.1:3100/api/events")
        for url in {tv, self.cfg.bus_emit}:
            try:
                await (await self.http()).post(url, json={"control": "reset"})
            except Exception:
                pass

    async def start(self, body: dict[str, Any]) -> dict[str, Any]:
        await self.stop()  # one match at a time

        red, blue = (body.get("red") or {}), (body.get("blue") or {})
        if isinstance(red, dict) and red.get("model"):
            self.cfg.red_model = _claude_model(str(red["model"]))
        if isinstance(blue, dict) and blue.get("model"):
            self.cfg.blue_model = _claude_model(str(blue["model"]))
        if body.get("rounds"):
            self.cfg.total_rounds = int(body["rounds"])
        if body.get("turn_seconds"):
            self.cfg.turn_seconds = float(body["turn_seconds"])

        if not self.booted:
            await self.procs.start_orchestrator()
            await self.procs.start_mcps()
            self.booted = True
        await self._route_through_narrator()  # voice on if narrator up, silent TV if not
        await self._reset_tv()

        if MOCK:
            from .mockagents import blue_mock, red_mock
            red_sess = AgentSession("attacker", self.cfg.red_model, self.cfg.mcp_server_spec("attacker"),
                                    None, None, cwd=str(self.cfg.repo), mock=red_mock)
            blue_sess = AgentSession("defender", self.cfg.blue_model, self.cfg.mcp_server_spec("defender"),
                                     None, None, cwd=str(self.cfg.repo), mock=blue_mock)
        else:
            red_sess = AgentSession("attacker", self.cfg.red_model, self.cfg.mcp_server_spec("attacker"),
                                    self.cfg.repo / "attacker" / "launch" / "system_prompt.txt",
                                    self.cfg.repo / "attacker" / "launch" / "settings.json",
                                    cwd=tempfile.mkdtemp(prefix="arena-red."))
            blue_sess = AgentSession("defender", self.cfg.blue_model, self.cfg.mcp_server_spec("defender"),
                                     self.cfg.repo / "defender" / "launch" / "system_prompt.txt",
                                     self.cfg.repo / "defender" / "launch" / "settings.json",
                                     cwd=str(self.cfg.repo))

        runner = MatchRunner(self.cfg, await self.http(), red_sess, blue_sess)
        self.started_at = int(time.time() * 1000)
        self.last_result = {}
        self.task = asyncio.create_task(self._run(runner))
        return {"ok": True, "startedAt": self.started_at, "mock": MOCK,
                "config": {"red": self.cfg.red_model, "blue": self.cfg.blue_model,
                           "rounds": self.cfg.total_rounds}}

    async def _run(self, runner: MatchRunner) -> None:
        try:
            self.last_result = await runner.run()
        except asyncio.CancelledError:
            self.last_result = {"stopped": True}
            raise
        except Exception as exc:  # never let a match crash the service
            self.last_result = {"error": str(exc)}

    async def stop(self) -> dict[str, Any]:
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except Exception:
                pass
        self.task = None
        return {"ok": True}

    def status(self) -> dict[str, Any]:
        return {"running": bool(self.task and not self.task.done()),
                "startedAt": self.started_at, "mock": MOCK, "result": self.last_result}

    async def shutdown(self) -> None:
        await self.stop()
        self.procs.stop_all()
        if self._http:
            await self._http.aclose()


_service = Service()


def _cors(resp: web.Response) -> web.Response:
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "content-type"
    return resp


async def h_start(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except Exception:
        body = {}
    return _cors(web.json_response(await _service.start(body)))


async def h_stop(req: web.Request) -> web.Response:
    return _cors(web.json_response(await _service.stop()))


async def h_status(req: web.Request) -> web.Response:
    return _cors(web.json_response(_service.status()))


async def h_options(req: web.Request) -> web.Response:
    return _cors(web.Response())


async def _on_cleanup(app: web.Application) -> None:
    await _service.shutdown()


def main() -> None:
    app = web.Application()
    app.router.add_post("/match/start", h_start)
    app.router.add_post("/match/stop", h_stop)
    app.router.add_get("/match/status", h_status)
    app.router.add_get("/health", h_status)
    app.router.add_route("OPTIONS", "/{tail:.*}", h_options)
    app.on_cleanup.append(_on_cleanup)
    port = int(os.environ.get("ARENA_RUNNER_PORT", "8799"))
    print(f"Arena match runner service on http://127.0.0.1:{port}  (mock_agents={MOCK})")
    web.run_app(app, host="127.0.0.1", port=port, print=None)


if __name__ == "__main__":
    main()
