"""Shared runtime: round/budget state, singletons, and the scoped HTTP helper.

Tools and the server both import these singletons. Keeping them in one place
avoids circular imports and gives the control surface a single object to reset
between rounds.
"""

from __future__ import annotations

import time
from typing import Any, Optional

import httpx

from . import config
from .bus import BusEmitter
from .oob import Collaborator


class RoundState:
    """The match clock + per-turn tool budget. A turn ends when the budget is
    spent OR the turn timer runs out OR the match ends — whichever comes first.
    The orchestrator drives it through the control surface (start_match/start_round).
    """

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
        self.target = config.TARGET_BASE

    def start_match(self, match_seconds: Optional[float] = None,
                    total_rounds: Optional[int] = None,
                    turn_seconds: Optional[float] = None) -> None:
        # `is not None` (not truthiness) so a 0 value is honored, not dropped.
        if match_seconds is not None:
            self.match_seconds = float(match_seconds)
        if total_rounds is not None:
            self.total_rounds = int(total_rounds)
        if turn_seconds is not None:
            self.turn_seconds = float(turn_seconds)
        self.match_start = time.monotonic()

    def start_round(self, round_: int, target: Optional[str] = None,
                    turn_seconds: Optional[float] = None) -> None:
        self.round = int(round_)
        self.used = 0
        self.turn_start = time.monotonic()
        if turn_seconds is not None:
            self.turn_seconds = float(turn_seconds)
        if target:
            self.target = target.rstrip("/")
        if self.match_start is None:
            self.match_start = time.monotonic()

    def reset(self) -> None:
        self.used = 0
        self.turn_start = time.monotonic()

    def remaining(self) -> int:
        return max(0, self.budget - self.used)

    # Clock math uses a monotonic clock so an NTP/wall-clock jump can never
    # add or subtract time mid-match.
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
        """Charge `cost` units. Returns False (and charges nothing) if the budget
        would overrun, the turn timer expired, or the match is over."""
        if self.time_up() or self.match_remaining() <= 0:
            return False
        if self.used + cost > self.budget:
            return False
        self.used += cost
        return True

    def status(self, tool_ms: Optional[float] = None) -> dict[str, Any]:
        """The match-clock block stamped into every tool result so the model can
        pace itself: time left, turns left, budget, and how long this call took."""
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
            "TURN OVER — stop now. No more tool calls, no more text. End your turn; "
            "you will be prompted when it is your turn again."
            if over else
            "Your turn is LIVE. Move fast — this is a sport. Recon or strike, prove it, claim it."
        )
        return block


# --- singletons ------------------------------------------------------------
bus = BusEmitter()
collab = Collaborator()
rounds = RoundState(config.ROUND_BUDGET)

# Named identities the attacker has captured (for multi-user IDOR / access work).
# name -> {"token": str|None, "email": str|None, "cookies": dict}
identities: dict[str, dict[str, Any]] = {}


def set_identity(name: str, *, token: Optional[str] = None,
                 email: Optional[str] = None, cookies: Optional[dict[str, str]] = None) -> None:
    identities[name] = {"token": token, "email": email, "cookies": cookies or {}}


def auth_for(name: Optional[str]) -> tuple[dict[str, str], dict[str, str]]:
    """Return (headers, cookies) for a stored identity, or empty if unknown/None."""
    if not name:
        return {}, {}
    ident = identities.get(name)
    if not ident:
        return {}, {}
    headers: dict[str, str] = {}
    if ident.get("token"):
        headers["Authorization"] = f"Bearer {ident['token']}"
    return headers, dict(ident.get("cookies") or {})

_http_client: Optional[httpx.AsyncClient] = None


async def http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=config.HTTP_TIMEOUT,
            follow_redirects=False,  # observe 30x; never chase off-scope
        )
    return _http_client


def _detect_block(status: int, headers: dict[str, str]) -> Optional[dict[str, Any]]:
    """A 403/429, or an explicit defender marker header, means Blue patched
    this path. Surfacing it powers the 'pivot' beat."""
    blocked_by = headers.get("x-blocked-by") or headers.get("X-Blocked-By")
    if blocked_by or status in (403, 429):
        return {
            "blocked": True,
            "by": blocked_by or "waf",
            "rule": headers.get("x-block-rule") or headers.get("X-Block-Rule"),
            "status": status,
        }
    return None


async def scoped_request(
    method: str,
    target: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Any = None,
    data: Any = None,
    headers: Optional[dict[str, str]] = None,
    cookies: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """Make one in-scope HTTP request and return a flat, model-friendly result.

    `target` may be a bare path or a full in-scope URL; config.resolve_target
    enforces the host allowlist and raises ScopeError on anything off-box.
    """
    url = config.resolve_target(target)
    client = await http_client()
    # Clear any session cookie a prior response stored, so auth is carried ONLY
    # by what this call passes explicitly (Bearer header / cookies arg). Without
    # this the shared client would leak one identity's login into the next call
    # (an 'anon' or cross-identity request would silently reuse a session).
    client.cookies.clear()
    started = time.perf_counter()
    resp = await client.request(
        method.upper(),
        url,
        params=params or None,
        json=json_body if json_body is not None else None,
        content=data if data is not None else None,
        headers=headers or None,
        cookies=cookies or None,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    body = resp.text
    truncated = len(body) > config.BODY_TRUNC
    hdrs = {k: v for k, v in resp.headers.items()}
    return {
        "url": url,
        "method": method.upper(),
        "status": resp.status_code,
        "elapsed_ms": elapsed_ms,
        "headers": hdrs,
        "body": body[: config.BODY_TRUNC],
        "body_truncated": truncated,
        "body_len": len(body),
        "blocked": _detect_block(resp.status_code, hdrs),
    }


async def startup() -> None:
    await collab.start()


async def shutdown() -> None:
    await collab.stop()
    await bus.aclose()
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None
