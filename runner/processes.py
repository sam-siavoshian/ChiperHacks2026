"""Subprocess lifecycle: the control plane + the two HTTP MCP services.

The MCPs run as persistent streamable-http servers so their control surfaces (and
the match clock) outlive any single session, and the Claude sessions connect to
them by URL. Everything started here is torn down on exit.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
from typing import Optional

import httpx

from .config import Config


def _port(url: str) -> str:
    return url.rsplit(":", 1)[1].split("/")[0]


class ProcManager:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.procs: list[tuple[str, subprocess.Popen]] = []

    def _spawn(self, name: str, cmd: list[str], env: Optional[dict] = None, cwd: Optional[str] = None) -> subprocess.Popen:
        log = open(f"/tmp/arena-{name}.log", "w")
        p = subprocess.Popen(cmd, env={**os.environ, **(env or {})},
                             cwd=cwd or str(self.cfg.repo), stdout=log, stderr=subprocess.STDOUT)
        self.procs.append((name, p))
        return p

    async def _wait_http(self, url: str, timeout: float = 25.0, method: str = "get") -> bool:
        async with httpx.AsyncClient(timeout=2.0) as c:
            for _ in range(int(timeout / 0.5)):
                try:
                    r = await (c.get(url) if method == "get" else c.post(url, json={}))
                    if r.status_code < 500:
                        return True
                except Exception:
                    pass
                await asyncio.sleep(0.5)
        return False

    async def start_orchestrator(self) -> None:
        if not self.cfg.start_orchestrator:
            return
        if await self._wait_http(f"{self.cfg.control_plane}/state", timeout=1.0):
            return  # already up
        self._spawn("orchestrator", ["bun", "run", "arena/orchestrator/server.ts"],
                    env={"ARENA_ENFORCE_TURNS": "0",  # the runner owns turn alternation
                         "ARENA_BUS_EMIT": self.cfg.bus_emit,
                         "ARENA_BUS": self.cfg.bus, "ARENA_BUS_EMIT_PATH": self.cfg.bus_emit_path})
        if not await self._wait_http(f"{self.cfg.control_plane}/state", timeout=30.0):
            raise RuntimeError(f"orchestrator did not come up on {self.cfg.control_plane} (see /tmp/arena-orchestrator.log)")

    async def start_mcps(self) -> None:
        if not self.cfg.start_mcps:
            return
        py = str(self.cfg.repo / ".venv" / "bin" / "python")
        self._spawn("attacker-mcp", [py, "-m", "attacker.server"],
                    env={"ARENA_MCP_HTTP_PORT": str(self.cfg.attacker_mcp_port),
                         "ARENA_TARGET": "http://127.0.0.1:4000",
                         "ARENA_JUDGE_URL": f"{self.cfg.control_plane}/claim",
                         "ARENA_BUS": self.cfg.bus, "ARENA_BUS_EMIT_PATH": self.cfg.bus_emit_path})
        self._spawn("defender-mcp", [py, "-m", "defender.server"],
                    env={"ARENA_MCP_HTTP_PORT": str(self.cfg.defender_mcp_port),
                         "ARENA_CONTROL_PLANE": self.cfg.control_plane, "ARENA_REPO": str(self.cfg.repo),
                         "ARENA_BUS": self.cfg.bus, "ARENA_BUS_EMIT_PATH": self.cfg.bus_emit_path})
        a = await self._wait_http(f"{self.cfg.attacker_control}/status", timeout=25.0)
        d = await self._wait_http(f"{self.cfg.defender_control}/status", timeout=25.0)
        if not (a and d):
            raise RuntimeError(f"MCP control surfaces not up (attacker={a} defender={d}); "
                               "see /tmp/arena-attacker-mcp.log, /tmp/arena-defender-mcp.log")

    def stop_all(self) -> None:
        for _, p in reversed(self.procs):
            try:
                p.terminate()
            except Exception:
                pass
        for name, p in self.procs:
            try:
                p.wait(timeout=3)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
