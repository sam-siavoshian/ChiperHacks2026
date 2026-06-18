"""Async HTTP clients + broadcast envelopes for the match runner."""

from __future__ import annotations

import itertools
import time
from typing import Any, Optional

import httpx

_seq = itertools.count(1)


def envelope(agent: str, type_: str, payload: dict[str, Any], *,
             target: Optional[str] = None, round_: int = 0) -> dict[str, Any]:
    return {
        "id": f"evt_run_{next(_seq):06x}",
        "ts": int(time.time() * 1000),
        "round": round_,
        "agent": agent,
        "type": type_,
        "target": target,
        "payload": payload,
    }


class ControlPlane:
    """The orchestrator/judge at :4100 — owns board, scoring, reset."""

    def __init__(self, base: str, http: httpx.AsyncClient) -> None:
        self.base = base.rstrip("/")
        self.http = http

    async def start_match(self, duration_ms: int) -> dict[str, Any]:
        r = await self.http.post(f"{self.base}/match/start", json={"durationMs": duration_ms})
        return r.json()

    async def state(self) -> dict[str, Any]:
        try:
            r = await self.http.get(f"{self.base}/state")
            return r.json()
        except Exception as exc:
            return {"error": str(exc)}

    async def hint(self) -> str:
        try:
            r = await self.http.get(f"{self.base}/hint")
            return (r.json() or {}).get("area", "") if r.status_code == 200 else ""
        except Exception:
            return ""

    async def stop(self) -> dict[str, Any]:
        try:
            r = await self.http.post(f"{self.base}/match/stop")
            return r.json()
        except Exception as exc:
            return {"error": str(exc)}


class McpControl:
    """One side's MCP control surface (start_match / start_round / status)."""

    def __init__(self, base: str, http: httpx.AsyncClient) -> None:
        self.base = base.rstrip("/")
        self.http = http

    async def start_match(self, match_seconds: float, total_rounds: int, turn_seconds: float) -> None:
        await self._post("/start_match", {"match_seconds": match_seconds,
                                          "total_rounds": total_rounds, "turn_seconds": turn_seconds})

    async def start_round(self, round_: int, turn_seconds: float) -> None:
        await self._post("/start_round", {"round": round_, "turn_seconds": turn_seconds})

    async def status(self) -> dict[str, Any]:
        try:
            r = await self.http.get(f"{self.base}/status")
            return r.json()
        except Exception as exc:
            return {"error": str(exc)}

    async def _post(self, path: str, body: dict[str, Any]) -> None:
        try:
            await self.http.post(f"{self.base}{path}", json=body)
        except Exception:
            pass  # control is best-effort; the clock is a UI aid


class Tv:
    """Fire-and-forget broadcast of match-framing events to the bus."""

    def __init__(self, emit_url: str, http: httpx.AsyncClient) -> None:
        self.emit_url = emit_url
        self.http = http
        self.failures = 0

    async def emit(self, env: dict[str, Any]) -> None:
        try:
            await self.http.post(self.emit_url, json=env)
        except Exception:
            self.failures += 1
