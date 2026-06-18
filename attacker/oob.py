"""Out-of-band collaborator — the proof channel for blind bugs.

A tiny aiohttp listener bound to localhost. The attacker injects a unique
callback URL into a target parameter (an integration webhook, an SSTI payload,
an XXE entity). If the target's server fetches it, we record the hit. That hit
is hard proof the model cannot fake: the bug fired server-side.

Binds 127.0.0.1 only, so it never becomes an open relay.
"""

from __future__ import annotations

import secrets
import time
from typing import Any, Optional

from aiohttp import web

from .config import OOB_HOST


class Collaborator:
    def __init__(self, host: str = OOB_HOST) -> None:
        self.host = host
        self.port: Optional[int] = None
        self._runner: Optional[web.AppRunner] = None
        self.hits: dict[str, list[dict[str, Any]]] = {}

    async def start(self) -> None:
        if self._runner is not None:
            return
        app = web.Application()
        app.router.add_route("*", "/{token}", self._handle)
        app.router.add_route("*", "/{token}/{tail:.*}", self._handle)
        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        site = web.TCPSite(runner, self.host, 0)  # 0 -> ephemeral port
        await site.start()
        self.port = self._read_port(site)
        if not self.port:
            await runner.cleanup()
            raise RuntimeError("could not determine OOB collaborator port")
        self._runner = runner

    @staticmethod
    def _read_port(site: web.TCPSite) -> Optional[int]:
        """Read the bound ephemeral port. aiohttp has no public accessor, so
        reach through the asyncio.Server sockets with a defensive guard."""
        try:
            server = getattr(site, "_server", None)
            socks = list(getattr(server, "sockets", None) or [])
            if socks:
                return socks[0].getsockname()[1]
        except Exception:
            pass
        return None

    async def stop(self) -> None:
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None
            self.port = None

    async def _handle(self, request: web.Request) -> web.Response:
        token = request.match_info.get("token", "")
        self.hits.setdefault(token, []).append(
            {
                "ts": int(time.time() * 1000),
                "method": request.method,
                "path": request.path,
                "ua": request.headers.get("User-Agent", ""),
                "from": request.remote,
            }
        )
        return web.Response(text="ok")

    def issue(self) -> tuple[str, str]:
        """Return (token, url). Inject the url; later poll with check(token)."""
        if self.port is None:
            raise RuntimeError("collaborator not started")
        token = secrets.token_hex(8)
        self.hits.setdefault(token, [])
        return token, f"http://{self.host}:{self.port}/{token}"

    def check(self, token: str) -> list[dict[str, Any]]:
        return list(self.hits.get(token, []))
