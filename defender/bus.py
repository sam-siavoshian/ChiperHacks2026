"""Broadcast event envelopes + fire-and-forget emitter (blue side).

The orchestrator emits the authoritative blue scoring events (blue.detect /
blue.mitigate / blue.blocked / score.update) when it judges a patch. The defender
MCP only emits NARRATION here — an intent line before each tool call and an
outcome line after — so the caster can hype what blue is doing live. Emission
never blocks a tool and never raises.
"""

from __future__ import annotations

import itertools
import time
from typing import Any, Optional

import httpx

from .config import ARENA_BUS, BUS_EMIT_PATH

_seq = itertools.count(1)


def _evt_id() -> str:
    return f"evt_{next(_seq):08x}"


def envelope(agent: str, type_: str, payload: dict[str, Any], *,
             target: Optional[str] = None, round_: int = 0) -> dict[str, Any]:
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
    """POSTs envelopes to {ARENA_BUS}{BUS_EMIT_PATH}. Best-effort, never raises."""

    def __init__(self) -> None:
        self._client: Optional[httpx.AsyncClient] = None
        self.sent: list[dict[str, Any]] = []
        self.failures = 0
        self.capture = False  # record only, no network (for tests)

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
