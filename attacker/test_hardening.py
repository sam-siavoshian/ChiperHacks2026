"""Adversarial hardening tests for the attacker MCP.

Beyond the happy-path selftest: these attack the MCP itself — try to escape the
scope lock, blow the budget via concurrency, crash tools with malformed input,
kill the bus, and churn the lifecycle. All offline (no target, no network):
runtime.scoped_request is stubbed where a request would otherwise be made, so the
results are deterministic.

Run:  python -m attacker.test_hardening
Exit 0 only if every assertion holds.
"""

from __future__ import annotations

import asyncio
import sys

from . import config, runtime, tools
from .config import ScopeError

_results: list[tuple[bool, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    _results.append((bool(ok), name, detail))


# --- 1. SCOPE GUARD: the security floor ------------------------------------
# Invariant: resolve_target either returns an in-scope URL (netloc == allowed)
# or raises ScopeError. It must NEVER return a URL pointing at another host.
def test_scope_invariant() -> None:
    from urllib.parse import urlsplit

    must_reject = [
        "http://evil.com/",
        "https://evil.com/x",
        "http://127.0.0.1:4001/",            # wrong port
        "http://127.0.0.1:4000.evil.com/",   # suffix trick
        "http://127.0.0.1:4000@evil.com/",   # userinfo trick
        "http://evil.com#@127.0.0.1:4000",   # fragment trick
        "http://[::1]:4000/",                # ipv6 localhost != ipv4
        "http://169.254.169.254/latest/",    # cloud metadata
        "file:///etc/passwd",
        "gopher://127.0.0.1:4000/",
        "dict://127.0.0.1:4000/",
        "ftp://127.0.0.1:4000/",
        "http://localhost:4000/",            # name != ip netloc
        "",
        "   ",
    ]
    allowed_netloc = config.ALLOWED_NETLOC
    leaked = []
    for u in must_reject:
        try:
            out = config.resolve_target(u)
            net = urlsplit(out).netloc
            if net != allowed_netloc:
                leaked.append(f"{u!r} -> {out!r} (netloc {net!r})")
        except ScopeError:
            pass  # correct
        except Exception as exc:
            leaked.append(f"{u!r} raised {exc!r}")
    check("scope: no off-host URL escapes", not leaked, "; ".join(leaked)[:300])

    # In-scope inputs must resolve and stay on the allowed host.
    on_host = []
    for path in ["/api/x", "api/y", "/", "http://127.0.0.1:4000/api/z", "//evil.com/x", "/a?b=c#d",
                 "/api/auth/sso/callback?next=https://evil.com/x"]:  # URL in query = still a path
        try:
            out = config.resolve_target(path)
            if urlsplit(out).netloc != allowed_netloc:
                on_host.append(f"{path!r} -> {out!r}")
        except ScopeError as exc:
            on_host.append(f"{path!r} wrongly rejected: {exc}")
    check("scope: in-scope paths stay on host", not on_host, "; ".join(on_host)[:300])


# --- 2. BUDGET under concurrency -------------------------------------------
# Fire many tool calls at once; the budget must never be exceeded and the count
# of allowed calls must equal exactly the budget. Stub the network out.
async def test_budget_concurrency() -> None:
    sent = {"n": 0}

    async def stub(method, target, **kw):
        sent["n"] += 1
        await asyncio.sleep(0.01)  # force interleaving
        return {"url": "x", "method": method, "status": 200, "elapsed_ms": 1.0,
                "headers": {}, "body": "{}", "body_truncated": False, "body_len": 2, "blocked": None}

    orig = runtime.scoped_request
    runtime.scoped_request = stub  # type: ignore
    runtime.bus.capture = True
    try:
        budget = runtime.rounds.budget
        runtime.rounds.start_round(1, config.TARGET_BASE)
        calls = [tools.http_request("GET", "/api/health") for _ in range(budget * 3)]
        out = await asyncio.gather(*calls)
        ok = sum(1 for r in out if "error" not in r)
        refused = sum(1 for r in out if r.get("error") == "budget_exhausted")
        check("budget: never exceeded under concurrency",
              ok == budget and sent["n"] == budget and refused == budget * 2,
              f"allowed={ok} actually_sent={sent['n']} refused={refused} budget={budget}")
    finally:
        runtime.scoped_request = orig  # type: ignore
        runtime.bus.capture = False


# --- 3. MALFORMED INPUT: tools return errors, never crash ------------------
async def test_malformed_inputs() -> None:
    runtime.bus.capture = True
    crashes = []

    async def safe(label, coro):
        runtime.rounds.start_round(1, config.TARGET_BASE)
        try:
            r = await coro
            if not isinstance(r, dict):
                crashes.append(f"{label}: returned {type(r)}")
        except Exception as exc:
            crashes.append(f"{label}: raised {exc!r}")

    try:
        await safe("decode garbage", tools.decode("!!!not base64!!!"))
        await safe("jwt_inspect non-jwt", tools.jwt_inspect("notajwt"))
        await safe("jwt_inspect empty", tools.jwt_inspect(""))
        await safe("forge_jwt bad alg", tools.forge_jwt({"a": 1}, secret="k", alg="BOGUS"))
        await safe("diff_probe bad location", tools.diff_probe("GET", "/api/x", "p", "header", "a", "b"))
        await safe("idor unknown identity", tools.idor_probe("GET", "/api/x", identities=["ghost"]))
        await safe("race n=0 (clamped)", tools.race_probe("GET", "/api/health", n=0))
        await safe("whoami unknown", tools.whoami("nobody"))
        await safe("browser no args", tools.browser_probe())
        check("malformed inputs never crash", not crashes, "; ".join(crashes)[:300])
    finally:
        runtime.bus.capture = False


# --- 4. BUS-DOWN resilience: emit must not raise or block ------------------
async def test_bus_down() -> None:
    import httpx
    from .bus import BusEmitter, envelope

    # Point a real emitter at a dead port; emit must swallow the failure.
    em = BusEmitter()
    em._client = httpx.AsyncClient(timeout=0.3)
    import attacker.config as cfg
    old = cfg.ARENA_BUS
    cfg.ARENA_BUS = "http://127.0.0.1:1"  # nothing listening
    try:
        await em.emit(envelope("recon", "attempting", {"x": 1}))
        check("bus down: emit swallows failure", em.failures >= 1 and len(em.sent) == 1,
              f"failures={em.failures} sent={len(em.sent)}")
    except Exception as exc:
        check("bus down: emit swallows failure", False, repr(exc))
    finally:
        cfg.ARENA_BUS = old
        await em.aclose()


# --- 5. LIFECYCLE: startup/shutdown idempotent, no leak --------------------
async def test_lifecycle() -> None:
    try:
        await runtime.startup()
        p1 = runtime.collab.port
        await runtime.startup()  # second call must be a no-op, same port
        p2 = runtime.collab.port
        ok_start = p1 is not None and p1 == p2
        await runtime.shutdown()
        ok_stop = runtime.collab.port is None
        # restart after shutdown works
        await runtime.startup()
        ok_restart = runtime.collab.port is not None
        await runtime.shutdown()
        check("lifecycle: startup idempotent + clean restart", ok_start and ok_stop and ok_restart,
              f"p1={p1} p2={p2}")
    except Exception as exc:
        check("lifecycle: startup idempotent + clean restart", False, repr(exc))


# --- 6. MATCH CLOCK: clamping + turn_over on budget / time / match ---------
def test_clock_invariants() -> None:
    import time as _t
    try:
        rs = runtime.RoundState(budget=3, match_seconds=50, turn_seconds=50, total_rounds=4)
        s0 = rs.status()  # before start_match: no crash, full remaining, all fields
        before_ok = (s0["match_remaining_s"] == 50 and s0["turn_remaining_s"] == 50
                     and {"round", "turns_remaining", "budget_remaining", "turn_over", "advice"} <= set(s0)
                     and s0["turns_remaining"] == 4)
        # turn timer clamps to 0 and flips turn_over + blocks spend
        rs.start_match(); rs.start_round(1, turn_seconds=0.01)
        _t.sleep(0.05)
        turn_ok = rs.turn_remaining() == 0.0 and rs.turn_over() and not rs.spend()
        # match clock clamps to 0 and ends the turn regardless of budget
        rs2 = runtime.RoundState(budget=9, match_seconds=0.01, turn_seconds=50, total_rounds=4)
        rs2.start_match(); _t.sleep(0.05); rs2.start_round(1)
        match_ok = rs2.match_remaining() == 0.0 and rs2.turn_over() and not rs2.spend()
        check("clock: clamps to 0, turn_over on time AND match end",
              before_ok and turn_ok and match_ok,
              f"before={before_ok} turn={turn_ok} match={match_ok}")
    except Exception as exc:
        check("clock: clamps to 0, turn_over on time AND match end", False, repr(exc))


# --- 7. auto_report WRAPPER integrity --------------------------------------
async def test_wrapper_integrity() -> None:
    calls = {"n": 0}

    async def stub(method, target, **kw):
        calls["n"] += 1
        return {"url": "x", "method": method, "status": 404, "elapsed_ms": 1.0, "headers": {},
                "body": "", "body_truncated": False, "body_len": 0, "blocked": None}

    orig = runtime.scoped_request
    runtime.scoped_request = stub  # type: ignore
    runtime.bus.capture = True
    try:
        wrapped = tools.auto_report(tools.fuzz_paths)  # a charged tool

        # (a) the wrapper adds NO extra budget cost (tool charges 1, wrapper 0)
        runtime.rounds.start_match(match_seconds=1000, turn_seconds=1000)
        runtime.rounds.start_round(1)
        await wrapped(words=["a"])
        no_extra_budget = runtime.rounds.used == 1

        # (b) the match clock is injected into the result
        runtime.rounds.start_round(1)
        out = await wrapped(words=["a"])
        injected = isinstance(out.get("match"), dict) and "tool_ms" in out["match"]

        # (c) a non-dict tool return must not crash the wrapper
        async def returns_str():
            return "literal"
        returns_str.__name__ = "decode"
        nondict = await tools.auto_report(returns_str)()
        nondict_ok = nondict == "literal"

        # (d) a charged tool called past the turn timer does NO network work
        runtime.rounds.start_round(1, turn_seconds=0.0)
        before = calls["n"]
        res = await wrapped(words=["a"])
        time_up_no_work = res.get("error") in ("turn_time_up", "match_over") and calls["n"] == before

        check("wrapper: no extra budget, injects clock, non-dict safe, time-up does no work",
              no_extra_budget and injected and nondict_ok and time_up_no_work,
              f"budget={no_extra_budget} inject={injected} nondict={nondict_ok} timeup={time_up_no_work}")
    except Exception as exc:
        check("wrapper: no extra budget, injects clock, non-dict safe, time-up does no work", False, repr(exc))
    finally:
        runtime.scoped_request = orig  # type: ignore
        runtime.bus.capture = False


# --- 8. clock + budget hold under concurrent tool calls --------------------
async def test_clock_concurrency() -> None:
    sent = {"n": 0}

    async def stub(method, target, **kw):
        sent["n"] += 1
        await asyncio.sleep(0.01)
        return {"url": "x", "method": method, "status": 404, "elapsed_ms": 1.0, "headers": {},
                "body": "", "body_truncated": False, "body_len": 0, "blocked": None}

    orig = runtime.scoped_request
    runtime.scoped_request = stub  # type: ignore
    runtime.bus.capture = True
    try:
        runtime.rounds.start_match(match_seconds=1000, turn_seconds=1000)
        runtime.rounds.start_round(1)
        budget = runtime.rounds.budget
        wrapped = tools.auto_report(tools.fuzz_paths)
        outs = await asyncio.gather(*(wrapped(words=["a"]) for _ in range(budget * 3)))
        ok = sum(1 for o in outs if "error" not in o)
        over = sum(1 for o in outs if o.get("error"))
        check("clock+budget under concurrency: exactly budget run, rest turn-over",
              ok == budget and sent["n"] == budget and over == budget * 2,
              f"ran={ok} network={sent['n']} over={over} budget={budget}")
    except Exception as exc:
        check("clock+budget under concurrency: exactly budget run, rest turn-over", False, repr(exc))
    finally:
        runtime.scoped_request = orig  # type: ignore
        runtime.bus.capture = False


# --- 9. STOP RULE: after turn_over, NO tool runs (free ones included) -------
async def test_stop_rule() -> None:
    net = {"n": 0}

    async def stub(method, target, **kw):
        net["n"] += 1
        return {"url": "x", "method": method, "status": 200, "elapsed_ms": 1.0, "headers": {},
                "body": "{}", "body_truncated": False, "body_len": 2, "blocked": None}

    orig = runtime.scoped_request
    runtime.scoped_request = stub  # type: ignore
    runtime.bus.capture = True  # also stops claim_exploit's judge POST
    try:
        runtime.rounds.start_match(match_seconds=1000, turn_seconds=0.0)
        runtime.rounds.start_round(1, turn_seconds=0.0)  # turn is immediately over
        terminal = {"turn_time_up", "match_over", "budget_exhausted"}
        blocked = []
        for fn, args in (
            (tools.fuzz_paths, ()),            # charged
            (tools.http_request, ("GET", "/api/health")),  # charged, would hit network
            (tools.decode, ("aGk=",)),         # free
            (tools.jwt_inspect, ("a.b.c",)),   # free
            (tools.claim_exploit, ("sqli", "/api/x", "evidence")),  # free, would POST judge
        ):
            r = await tools.auto_report(fn)(*args)
            blocked.append(isinstance(r, dict) and r.get("error") in terminal)
        briefing_ok = "briefing" in (await tools.auto_report(tools.init_attacker)())  # exempt
        check("stop rule: every tool refuses after turn_over (free incl), no work, init exempt",
              all(blocked) and net["n"] == 0 and briefing_ok,
              f"blocked={blocked} network_calls={net['n']} init_exempt={briefing_ok}")
    except Exception as exc:
        check("stop rule: every tool refuses after turn_over (free incl), no work, init exempt", False, repr(exc))
    finally:
        runtime.scoped_request = orig  # type: ignore
        runtime.bus.capture = False


async def run() -> int:
    test_scope_invariant()
    await test_budget_concurrency()
    await test_malformed_inputs()
    await test_bus_down()
    await test_lifecycle()
    test_clock_invariants()
    await test_wrapper_integrity()
    await test_clock_concurrency()
    await test_stop_rule()

    print("\n=== attacker MCP hardening tests ===")
    failed = 0
    for ok, name, detail in _results:
        mark = "✓" if ok else "✗"
        line = f"  {mark} {name}"
        if not ok:
            line += f"   {detail}"
            failed += 1
        print(line)
    print(f"\n{len(_results) - failed}/{len(_results)} hardening checks passed.\n")
    return 1 if failed else 0


def main() -> None:
    sys.exit(asyncio.run(run()))


if __name__ == "__main__":
    main()
