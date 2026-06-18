"""Self-test for the Arena defender MCP — fully deterministic, no live services.

Covers: tool registration, the briefing, get_intel/submit_patch/get_board against
a stubbed orchestrator, the match clock in every return, the stop-gate (nothing
runs after turn_over), wrapper integrity (no extra budget, non-dict safe), and the
clock invariants. Run: python -m defender.selftest
"""

from __future__ import annotations

import asyncio
import sys

from . import config, runtime, tools
from .bus import envelope
from .server import mcp  # importing registers tools

_results: list[tuple[bool, str, str]] = []


def rec(name: str, ok: bool, detail: str = "") -> None:
    _results.append((bool(ok), name, detail))


# --- stub orchestrator -----------------------------------------------------
class _Resp:
    def __init__(self, status: int, data) -> None:
        self.status_code = status
        self._d = data

    def json(self):
        return self._d


class _StubOrch:
    def __init__(self, area="login", valid=True) -> None:
        self.area = area
        self.valid = valid

    async def get(self, url):
        if url.endswith("/hint"):
            return _Resp(200, {"area": self.area})
        if url.endswith("/state"):
            return _Resp(200, {"turn": "blue", "turnNo": 2, "red": 1, "blue": 5, "over": False})
        return _Resp(404, {})

    async def post(self, url, json=None):
        return _Resp(200, {"verdict": {
            "vulnId": (json or {}).get("vulnId"), "area": self.area, "valid": self.valid,
            "exploitStillWorks": not self.valid, "featureBroken": False,
            "reasoning": "exploit no longer lands; feature works" if self.valid else "still exploitable",
        }, "state": {"turn": "red", "blue": 10 if self.valid else 4}})


def _use_stub(area="login", valid=True) -> None:
    runtime._http_client = _StubOrch(area, valid)  # type: ignore


def _fresh_turn() -> None:
    runtime.rounds.start_match(match_seconds=100000, turn_seconds=100000, total_rounds=6)
    runtime.rounds.start_round(1)


async def run() -> int:
    runtime.bus.capture = True
    _use_stub()

    # 1) registration
    listed = {t.name for t in await mcp.list_tools()}
    rec("tool registration", {"init_defender", "get_intel", "submit_patch", "get_board"} <= listed,
        f"missing={ {'init_defender','get_intel','submit_patch','get_board'} - listed}")

    # 2) briefing complete, no honor-code leak
    _fresh_turn()
    b = (await tools.init_defender())["briefing"]
    rec("init_defender briefing complete",
        "submit_patch" in b and "get_intel" in b and "feature must" in b.lower()
        and len(b) > 800 and "honor" not in b.lower(),
        f"len={len(b)}")

    # 3) get_intel returns the area + candidates from the public manifest
    _fresh_turn()
    intel = await tools.get_intel()
    cands = intel.get("candidates", [])
    login_only = all("login" in (c.get("area", "").lower()) for c in cands) if cands else False
    rec("get_intel: area + filtered candidates", intel["area"] == "login" and len(cands) >= 1 and login_only,
        f"area={intel['area']} candidates={len(cands)}")

    # 4) submit_patch: valid verdict surfaced + costs budget
    _fresh_turn()
    before = runtime.rounds.used
    res = await tools.submit_patch("sqli-login", summary="parameterized login query")
    rec("submit_patch: SAVE verdict + costs 1",
        res.get("valid") is True and "SAVE" in res.get("outcome", "") and runtime.rounds.used == before + 1,
        f"valid={res.get('valid')} used_delta={runtime.rounds.used - before}")

    # 5) submit_patch: rejected verdict surfaced
    _use_stub(valid=False)
    _fresh_turn()
    res2 = await tools.submit_patch("sqli-login")
    rec("submit_patch: rejected verdict surfaced",
        res2.get("valid") is False and "REJECTED" in res2.get("outcome", ""),
        f"valid={res2.get('valid')}")
    _use_stub(valid=True)

    # 6) every tool return carries the match clock (wrapper injection)
    _fresh_turn()
    wrapped = tools.auto_report(tools.get_board)
    out = await wrapped()
    m = out.get("match", {})
    rec("every tool return carries the match clock",
        isinstance(m, dict) and {"tool_ms", "turn_remaining_s", "match_remaining_s", "turns_remaining"} <= set(m),
        f"keys={sorted(m)[:6]}")

    # 7) clock invariants: fields + turn_over on budget AND on time
    rs = runtime.RoundState(budget=2, match_seconds=50, turn_seconds=50, total_rounds=3)
    rs.start_match(); rs.start_round(1)
    s = rs.status(1.0)
    rs.spend(); rs.spend()
    over_budget = rs.turn_over() and not rs.spend()
    rs2 = runtime.RoundState(budget=9, match_seconds=50, turn_seconds=0.0, total_rounds=3)
    rs2.start_match(); rs2.start_round(1)
    over_time = rs2.turn_over() and not rs2.spend()
    rec("clock: fields + turn_over on budget & time",
        {"turn_over", "turn_remaining_s", "advice", "turns_remaining"} <= set(s)
        and s["turns_remaining"] == 2 and over_budget and over_time,
        f"budget={over_budget} time={over_time}")

    # 8) STOP RULE: after turn_over, NO tool runs (free incl), init exempt, no orchestrator call
    calls = {"n": 0}
    class _CountingOrch(_StubOrch):
        async def get(self, url):
            calls["n"] += 1
            return await super().get(url)
        async def post(self, url, json=None):
            calls["n"] += 1
            return await super().post(url, json)
    runtime._http_client = _CountingOrch()  # type: ignore
    runtime.rounds.start_match(match_seconds=1000, turn_seconds=0.0)
    runtime.rounds.start_round(1, turn_seconds=0.0)  # turn already over
    terminal = {"turn_time_up", "match_over", "budget_exhausted"}
    blocked = []
    for fn, args in ((tools.get_intel, ()), (tools.submit_patch, ("sqli-login",)), (tools.get_board, ())):
        r = await tools.auto_report(fn)(*args)
        blocked.append(isinstance(r, dict) and r.get("error") in terminal)
    init_ok = "briefing" in (await tools.auto_report(tools.init_defender)())
    rec("stop rule: every tool refuses after turn_over, no orchestrator call, init exempt",
        all(blocked) and calls["n"] == 0 and init_ok,
        f"blocked={blocked} orch_calls={calls['n']} init={init_ok}")

    # 9) wrapper: non-dict return must not crash
    async def returns_str():
        return "x"
    returns_str.__name__ = "get_board"
    _fresh_turn()
    nd = await tools.auto_report(returns_str)()
    rec("wrapper: non-dict return safe", nd == "x", repr(nd))

    runtime.bus.capture = False
    runtime._http_client = None  # drop the stub before shutdown (it has no aclose)
    await runtime.shutdown()

    width = max(len(n) for _, n, _ in _results)
    failed = 0
    print("\n=== Arena defender MCP selftest ===")
    for ok, name, detail in _results:
        mark = "✓" if ok else "✗"
        line = f"  {mark} {name.ljust(width)}"
        if not ok:
            line += f"   {detail}"
            failed += 1
        print(line)
    print(f"\n{len(_results) - failed}/{len(_results)} checks passed.\n")
    return 1 if failed else 0


def main() -> None:
    sys.exit(asyncio.run(run()))


if __name__ == "__main__":
    main()
