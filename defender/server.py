"""Arena defender MCP server.

Exposes the defender tool surface over stdio (for the blue Claude Code session)
and runs a small localhost control HTTP server the orchestrator uses to drive the
defender's turn clock.

Run:  python -m defender.server
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from aiohttp import web
from mcp.server.fastmcp import FastMCP

from . import config, runtime, tools


# --- control core (transport-agnostic) -------------------------------------
def _ctl_start_match(data: dict) -> dict:
    runtime.rounds.start_match(match_seconds=data.get("match_seconds"),
                               total_rounds=data.get("total_rounds"),
                               turn_seconds=data.get("turn_seconds"))
    return {"ok": True, "match": runtime.rounds.status()}


def _ctl_start_round(data: dict) -> dict:
    runtime.rounds.start_round(int(data.get("round", 0)), turn_seconds=data.get("turn_seconds"))
    return {"ok": True, "match": runtime.rounds.status()}


def _ctl_reset(_data: dict) -> dict:
    runtime.rounds.reset()
    return {"ok": True, "round": runtime.rounds.round}


def _ctl_status(_data: dict | None = None) -> dict:
    return {"match": runtime.rounds.status(), "bus_failures": runtime.bus.failures}


async def _aio(request: web.Request, fn) -> web.Response:
    data = await request.json() if request.method == "POST" else {}
    return web.json_response(fn(data))


async def _start_control() -> web.AppRunner:
    app = web.Application()
    app.router.add_post("/start_match", lambda r: _aio(r, _ctl_start_match))
    app.router.add_post("/start_round", lambda r: _aio(r, _ctl_start_round))
    app.router.add_post("/reset", lambda r: _aio(r, _ctl_reset))
    app.router.add_get("/status", lambda r: _aio(r, _ctl_status))
    app.router.add_get("/", lambda r: _aio(r, _ctl_status))
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, config.CONTROL_HOST, config.CONTROL_PORT)
    await site.start()
    return runner


@asynccontextmanager
async def _lifespan(_server: FastMCP):
    # MINIMAL for stdio (no control-server bind) so the MCP connects instantly and
    # stdout stays pure JSON-RPC. Control lives in the HTTP path only.
    try:
        yield {}
    finally:
        await runtime.shutdown()


mcp = FastMCP("arena-defender", lifespan=_lifespan)

for _fn in (
    tools.init_defender,   # read first
    tools.get_intel,       # free — the area RED is hitting + candidates
    tools.submit_patch,    # cost 1 — judge the source fix
    tools.get_board,       # free — scores / whose turn
):
    mcp.tool()(tools.auto_report(_fn))


def _run_http(port: int) -> None:
    """Persistent HTTP MCP for the match runner: control routes mounted on the same
    port (FastMCP's streamable-http lifespan only runs the session manager)."""
    import uvicorn
    from starlette.responses import JSONResponse

    host = os.environ.get("ARENA_MCP_HTTP_HOST", "127.0.0.1")
    mcp.settings.host, mcp.settings.port = host, port
    app = mcp.streamable_http_app()

    async def _ep_start_match(request):
        return JSONResponse(_ctl_start_match(await request.json()))

    async def _ep_start_round(request):
        return JSONResponse(_ctl_start_round(await request.json()))

    async def _ep_reset(request):
        return JSONResponse(_ctl_reset({}))

    async def _ep_status(request):
        return JSONResponse(_ctl_status())

    app.add_route("/start_match", _ep_start_match, methods=["POST"])
    app.add_route("/start_round", _ep_start_round, methods=["POST"])
    app.add_route("/reset", _ep_reset, methods=["POST"])
    app.add_route("/status", _ep_status, methods=["GET"])

    prev = app.router.lifespan_context

    @asynccontextmanager
    async def _life(a):
        try:
            async with prev(a):
                yield
        finally:
            await runtime.shutdown()

    app.router.lifespan_context = _life
    uvicorn.run(app, host=host, port=port, log_level="warning")


def main() -> None:
    port = os.environ.get("ARENA_MCP_HTTP_PORT")
    if port:
        _run_http(int(port))
    else:
        mcp.run()


if __name__ == "__main__":
    main()
