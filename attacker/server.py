"""Arena attacker MCP server.

Exposes the attacker tool surface over stdio (for the attacker Claude Code
session) and runs a small localhost control HTTP server the orchestrator uses to
advance rounds and reset the per-round budget between rounds.

Run:  python -m attacker.server
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from aiohttp import web
from mcp.server.fastmcp import FastMCP

from . import config, runtime, tools


# --- control core (transport-agnostic; the orchestrator drives the clock) ---
def _ctl_start_match(data: dict) -> dict:
    runtime.rounds.start_match(match_seconds=data.get("match_seconds"),
                               total_rounds=data.get("total_rounds"),
                               turn_seconds=data.get("turn_seconds"))
    return {"ok": True, "match": runtime.rounds.status()}


def _ctl_start_round(data: dict) -> dict:
    runtime.rounds.start_round(int(data.get("round", 0)), data.get("target"),
                               turn_seconds=data.get("turn_seconds"))
    return {"ok": True, "match": runtime.rounds.status()}


def _ctl_reset(_data: dict) -> dict:
    runtime.rounds.reset()
    runtime.collab.hits.clear()
    runtime.identities.clear()
    return {"ok": True, "round": runtime.rounds.round}


def _ctl_status(_data: dict | None = None) -> dict:
    r = runtime.rounds
    return {"match": r.status(), "target": r.target,
            "bus_failures": runtime.bus.failures, "oob_port": runtime.collab.port}


# --- stdio transport: control on its own aiohttp server (:CONTROL_PORT) ------
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


async def _aio(request: web.Request, fn) -> web.Response:
    data = await request.json() if request.method == "POST" else {}
    return web.json_response(fn(data))


@asynccontextmanager
async def _lifespan(_server: FastMCP):
    # MINIMAL for stdio: NOTHING runs at startup. Anything that touches the network
    # (a control-server bind, the OOB collaborator) risked noise on stdout or a hang
    # that left the MCP "pending" so the model never got its tools. The collaborator
    # starts lazily on first oob_collaborator(); control lives in the HTTP path only.
    try:
        yield {}
    finally:
        await runtime.shutdown()


mcp = FastMCP("arena-attacker", lifespan=_lifespan)

# The full 19-tool surface. Every tool is wrapped so it self-reports to the bus.
_ALL_TOOLS = (
    tools.init_attacker,
    tools.list_endpoints, tools.list_inputs, tools.fuzz_paths,
    tools.http_request, tools.diff_probe, tools.timing_probe, tools.race_probe,
    tools.param_fuzz, tools.analyze_response,
    tools.login, tools.whoami, tools.idor_probe,
    tools.oob_collaborator, tools.oob_check, tools.browser_probe,
    tools.forge_jwt, tools.jwt_inspect, tools.decode,
    tools.claim_exploit,
)
# A LEAN core (≈ the defender's size) for live matches: with a small toolset the
# tools load DIRECTLY instead of being deferred behind ToolSearch, so the model
# just calls them. Toggle with ARENA_LEAN_TOOLS=1.
_CORE_TOOLS = (
    tools.init_attacker, tools.list_endpoints, tools.http_request, tools.claim_exploit,
)
_TOOLS = _CORE_TOOLS if os.environ.get("ARENA_LEAN_TOOLS") not in (None, "", "0", "false") else _ALL_TOOLS
for _fn in _TOOLS:
    mcp.tool()(tools.auto_report(_fn))


def _run_http(port: int) -> None:
    """Persistent HTTP MCP for the match runner: the control routes + collaborator
    live on the same port and at server boot (FastMCP's streamable-http lifespan
    only runs the session manager, so we mount control + a lifespan wrap here)."""
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
        await runtime.startup()       # start the OOB collaborator in the serving loop
        try:
            async with prev(a):       # FastMCP's session-manager lifespan
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
