"""Shared runtime: the match clock + singletons + the orchestrator HTTP client.

The clock (RoundState) is the same hardened, mutation-tested implementation used
by the attacker: a turn ends when the budget is spent OR the turn timer runs out
OR the match ends, and the monotonic clock is immune to wall-clock jumps.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Optional

import httpx

from . import config
from .bus import BusEmitter


class RoundState:
    """The match clock + per-turn tool budget. Orchestrator-driven."""

    def __init__(self, budget: int, match_seconds: float = config.MATCH_SECONDS,
                 turn_seconds: float = config.TURN_SECONDS,
                 total_rounds: int = config.TOTAL_ROUNDS) -> None:
        self.budget = budget
        self.match_seconds = match_seconds
        self.turn_seconds = turn_seconds
        self.total_rounds = total_rounds
        self.round = 0
        self.used = 0
        self.match_start: Optional[float] = None
        self.turn_start: Optional[float] = None

    def start_match(self, match_seconds: Optional[float] = None,
                    total_rounds: Optional[int] = None,
                    turn_seconds: Optional[float] = None) -> None:
        if match_seconds is not None:
            self.match_seconds = float(match_seconds)
        if total_rounds is not None:
            self.total_rounds = int(total_rounds)
        if turn_seconds is not None:
            self.turn_seconds = float(turn_seconds)
        self.match_start = time.monotonic()

    def start_round(self, round_: int, turn_seconds: Optional[float] = None) -> None:
        self.round = int(round_)
        self.used = 0
        self.turn_start = time.monotonic()
        if turn_seconds is not None:
            self.turn_seconds = float(turn_seconds)
        if self.match_start is None:
            self.match_start = time.monotonic()

    def reset(self) -> None:
        self.used = 0
        self.turn_start = time.monotonic()

    def remaining(self) -> int:
        return max(0, self.budget - self.used)

    def turn_remaining(self) -> float:
        if self.turn_start is None:
            return float(self.turn_seconds)
        return max(0.0, self.turn_seconds - (time.monotonic() - self.turn_start))

    def match_remaining(self) -> float:
        if self.match_start is None:
            return float(self.match_seconds)
        return max(0.0, self.match_seconds - (time.monotonic() - self.match_start))

    def time_up(self) -> bool:
        return self.turn_start is not None and self.turn_remaining() <= 0

    def turn_over(self) -> bool:
        return self.used >= self.budget or self.time_up() or self.match_remaining() <= 0

    def spend(self, cost: int = 1) -> bool:
        if self.time_up() or self.match_remaining() <= 0:
            return False
        if self.used + cost > self.budget:
            return False
        self.used += cost
        return True

    def status(self, tool_ms: Optional[float] = None) -> dict[str, Any]:
        over = self.turn_over()
        block: dict[str, Any] = {
            "round": self.round,
            "turns_remaining": max(0, self.total_rounds - self.round),
            "budget_used": self.used,
            "budget_remaining": self.remaining(),
            "turn_remaining_s": round(self.turn_remaining(), 1),
            "match_remaining_s": round(self.match_remaining(), 1),
            "turn_over": over,
        }
        if tool_ms is not None:
            block["tool_ms"] = round(tool_ms, 1)
        block["advice"] = (
            "TURN OVER — stop now. No more tool calls, no more edits, no more text. "
            "End your turn; you will be prompted when it is your turn again."
            if over else
            "Your turn is LIVE. Move fast — this is a sport. Read the area, fix the flaw, submit the patch."
        )
        return block


# --- singletons ------------------------------------------------------------
bus = BusEmitter()
rounds = RoundState(config.ROUND_BUDGET)

_http_client: Optional[httpx.AsyncClient] = None


async def http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=config.HTTP_TIMEOUT)
    return _http_client


def load_manifest() -> list[dict[str, Any]]:
    """The PUBLIC vuln board (id/title/area/difficulty) — not the answer sheet."""
    try:
        data = json.loads(Path(config.MANIFEST_PATH).read_text())
        return list(data.get("nodes", []))
    except Exception:
        return []


async def shutdown() -> None:
    await bus.aclose()
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None
