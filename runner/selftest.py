"""End-to-end runner selftest — a real 1-round match with MOCK agents.

It boots the real orchestrator (control plane + app) via ProcManager, captures the
broadcast on a stub bus, and runs the full MatchRunner turn loop. The two "agents"
are scripted: RED lands the login SQLi and claims it; BLUE parameterizes the login
query in the actual source and submits the patch. This exercises the runner's turn
alternation, clock driving, control-plane integration, and TV framing — without a
live model. Run: python -m runner.selftest
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path

# Point the tool layers at the live arena BEFORE importing them.
REPO = Path(__file__).resolve().parents[1]
os.environ.setdefault("ARENA_TARGET", "http://127.0.0.1:4000")
os.environ.setdefault("ARENA_JUDGE_URL", "http://127.0.0.1:4100/claim")
os.environ.setdefault("ARENA_CONTROL_PLANE", "http://127.0.0.1:4100")

import httpx
from aiohttp import web

from .config import Config
from .match import MatchRunner
from .mockagents import blue_mock, red_mock
from .processes import ProcManager
from .session import AgentSession


class _StubBus:
    def __init__(self) -> None:
        self.events: list[dict] = []
        self.port = 0
        self._runner = None

    async def start(self) -> None:
        app = web.Application()
        app.router.add_post("/emit", self._emit)
        self._runner = web.AppRunner(app, access_log=None)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", 0)
        await site.start()
        self.port = list(site._server.sockets)[0].getsockname()[1]

    async def _emit(self, request):
        try:
            self.events.append(await request.json())
        except Exception:
            pass
        return web.Response(text="ok")

    async def stop(self) -> None:
        if self._runner:
            await self._runner.cleanup()

    def types(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for e in self.events:
            out[e.get("type", "?")] = out.get(e.get("type", "?"), 0) + 1
        return out


async def run() -> int:
    bus = _StubBus()
    await bus.start()
    cfg = Config()
    cfg.total_rounds = 1
    cfg.turn_seconds = 5
    cfg.turn_grace_seconds = 5
    cfg.match_seconds = 600
    cfg.start_mcps = False  # mock agents call the tool layer directly, not via HTTP MCP
    cfg.bus = f"http://127.0.0.1:{bus.port}"
    cfg.bus_emit_path = "/emit"
    os.environ["ARENA_BUS"] = cfg.bus
    os.environ["ARENA_BUS_EMIT_PATH"] = "/emit"

    procs = ProcManager(cfg)
    result, ok = {}, {}
    try:
        await procs.start_orchestrator()
        async with httpx.AsyncClient(timeout=20.0) as http:
            red = AgentSession("attacker", cfg.red_model, cfg.mcp_server_spec("attacker"), None, None,
                               cwd=str(REPO), mock=red_mock)
            blue = AgentSession("defender", cfg.blue_model, cfg.mcp_server_spec("defender"), None, None,
                                cwd=str(REPO), mock=blue_mock)
            result = await MatchRunner(cfg, http, red, blue).run()
    finally:
        procs.stop_all()
        await bus.stop()

    t = bus.types()
    checks = {
        "match completed with a result": bool(result) and "winner" in result,
        "RED scored a goal (live judge)": result.get("red", 0) >= 1,
        "TV got round_start for both turns": t.get("round_start", 0) >= 2,
        "TV got the scoring/blue events (orchestrator)":
            (t.get("exploit_success", 0) + t.get("blue.mitigate", 0) + t.get("score.update", 0)) >= 1,
        "TV got a round_end (final)": t.get("round_end", 0) >= 1,
        "TV got timer ticks": t.get("timer", 0) >= 1,
        "orchestrator scoring events flowed": (t.get("exploit_success", 0) + t.get("vuln_found", 0)
                                               + t.get("attempting", 0)) >= 1,
    }
    print("\n=== Arena match runner selftest ===")
    print("result:", result)
    print("broadcast event types:", t)
    failed = 0
    for name, passed in checks.items():
        print(f"  {'✓' if passed else '✗'} {name}")
        if not passed:
            failed += 1
    print(f"\n{len(checks) - failed}/{len(checks)} checks passed.\n")
    return 1 if failed else 0


def main() -> None:
    sys.exit(asyncio.run(run()))


if __name__ == "__main__":
    main()
