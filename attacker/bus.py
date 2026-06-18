"""Broadcast event envelopes + fire-and-forget emitter.

Shapes mirror `tv/lib/events.ts` exactly (the locked contract). The attacker
MCP self-emits red-lane events so the dashboard graph animates straight from a
tool call, with no separate stream-wrapper. Emission never blocks a tool and
never raises: a slow or dead bus must not break an attack.
"""

from __future__ import annotations

import itertools
import time
from typing import Any, Optional

import httpx

from .config import ARENA_BUS, BUS_EMIT_PATH

# --- defender "general area" hint ------------------------------------------
# First matching prefix wins, so list the specific ones first.
_AREAS: list[tuple[str, str]] = [
    ("/api/auth", "authentication"),
    ("/api/admin", "admin / access control"),
    ("/api/config", "config disclosure"),
    ("/api/preview", "templating / SSTI"),
    ("/api/net", "outbound / SSRF"),
    ("/api/directory", "user enumeration"),
    ("/api/tokens", "api tokens / auth"),
    ("/api/users", "user profile / IDOR"),
    ("/api/workspaces", "access control / membership"),
    ("/api/tasks", "tasks / stored content"),
    ("/api/search", "search / SQL"),
    ("/api/reports", "reporting / SQL"),
    ("/api/files", "file handling / path traversal"),
    ("/api/billing", "billing / payments"),
    ("/api/integrations", "outbound webhook / SSRF"),
]


def area_for(path: str) -> str:
    p = path or ""
    for prefix, label in _AREAS:
        if p.startswith(prefix):
            return label
    return "general"


# --- envelope builder ------------------------------------------------------
_seq = itertools.count(1)


def _evt_id() -> str:
    return f"evt_{next(_seq):08x}"


def envelope(
    agent: str,
    type_: str,
    payload: dict[str, Any],
    *,
    target: Optional[str] = None,
    round_: int = 0,
) -> dict[str, Any]:
    return {
        "id": _evt_id(),
        "ts": int(time.time() * 1000),
        "round": round_,
        "agent": agent,
        "type": type_,
        "target": target,
        "payload": payload,
    }


class BusEmitter:
    """POSTs envelopes to {ARENA_BUS}{BUS_EMIT_PATH}. Best-effort, never raises.

    Keeps a bounded tail of everything it tried to send so the selftest (and
    `capture` mode) can assert on emitted frames without a live bus.
    """

    def __init__(self) -> None:
        self._client: Optional[httpx.AsyncClient] = None
        self.sent: list[dict[str, Any]] = []
        self.failures = 0
        self.capture = False  # when True: record only, do not hit the network

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=2.5)
        return self._client

    async def emit(self, env: dict[str, Any]) -> None:
        self.sent.append(env)
        if len(self.sent) > 2000:
            del self.sent[:1000]
        if self.capture:
            return
        try:
            client = await self._get_client()
            await client.post(f"{ARENA_BUS}{BUS_EMIT_PATH}", json=env)
        except Exception:
            self.failures += 1

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
