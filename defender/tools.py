"""The defender tool surface — thin on purpose.

BLUE patches by editing the real source with its native file tools; the MCP only
hands it intel, submits patches to the judge, and narrates. The same hardened
clock / stop-gate / auto-report machinery as the attacker applies: every result
carries the match clock, and once the turn is over NOTHING runs.
"""

from __future__ import annotations

import inspect
import time
from functools import wraps
from typing import Any, Optional, get_type_hints

from . import config, runtime
from .bus import envelope


# --- budget + stop helpers -------------------------------------------------
def _turn_over_reason() -> str:
    r = runtime.rounds
    return ("match_over" if r.match_remaining() <= 0
            else "turn_time_up" if r.time_up()
            else "budget_exhausted")


def _budget_error() -> dict[str, Any]:
    r = runtime.rounds
    return {
        "error": _turn_over_reason(),
        "round": r.round, "used": r.used, "budget": r.budget,
        "hint": "Your turn is over. Stop now — no more tools, no more edits, no more text. "
                "You will be prompted when it is your turn again.",
    }


def _charge(cost: int = 1) -> Optional[dict[str, Any]]:
    return None if runtime.rounds.spend(cost) else _budget_error()


def _budget_now() -> dict[str, int]:
    """Per-turn tool-call budget snapshot, stamped into every `attempting`
    detail so the broadcast can render a live 'tools left this turn' HUD."""
    r = runtime.rounds
    return {"budget": r.budget, "used": r.used, "remaining": r.remaining()}


async def _emit(type_: str, payload: dict[str, Any], target: Optional[str] = None) -> None:
    await runtime.bus.emit(envelope("blue", type_, payload, target=target, round_=runtime.rounds.round))


def _area_match(manifest_area: str, hint: str) -> bool:
    a, h = (manifest_area or "").lower(), (hint or "").lower()
    return a == h or a in h or h in a


# --- briefing --------------------------------------------------------------
def _briefing() -> str:
    return f"""You are BLUE, the defender in THE ARENA.

THE GAME
The Arena is a live, narrated security match — a hacking duel broadcast like a
sport. A real web application is running and an attacker, RED, is breaking into
it in real time. You live INSIDE the codebase. Your job: find the vulnerability
RED is attacking and patch it in the source before RED scores — and keep the app
working.

YOUR WORKSPACE
You are in the Arena codebase. The vulnerable app's source is under
  {config.APP_DIR}/server
You patch by EDITING THOSE FILES directly with your normal file tools — read
them, find the flaw, fix it, save. No special tools needed to patch: just edit
the code. There are no hints or markers in the source pointing at the bugs.

INTEL
Each turn you are told the general AREA RED is targeting (login, IDOR, XSS,
billing, file access, ...). Call get_intel to get that area plus the candidate
vulnerabilities in it (id + title) from the public board. That points you at
WHERE to look; finding and fixing the real flaw is on you.

HOW TO WIN
1. get_intel — learn the area RED is hitting and the candidate vuln ids.
2. Read the source for that area; find the actual flaw.
3. Fix it in the source. CRITICAL: the feature must STILL WORK after your fix.
   A patch that breaks the feature does NOT count and costs you.
4. submit_patch(vuln_id) — the judge restarts the app with your edit and checks:
   the exploit must no longer land AND the feature must still work. Only then is
   it a SAVE.
5. A bad patch (still exploitable, or broke the feature) loses points and tips
   RED off to the target. Patch precisely, not broadly.

ROUNDS + CLOCK — A TIMED SPORT
You get a per-turn tool budget and a turn timer. Every result carries a "match"
block: turn_remaining_s, match_remaining_s, turns_remaining, budget_remaining,
tool_ms, turn_over. The moment turn_over is true, STOP IMMEDIATELY — no more
edits, no more tools, no more text. You will be prompted when it is your turn
again; pick up from where you left off.

Move FAST. Read the area, write a tight correct fix, submit. Wasted seconds let
RED score.

Now go. Start with get_intel."""


# --- tools -----------------------------------------------------------------
async def init_defender() -> dict[str, Any]:
    """READ THIS FIRST. Your full briefing: the game, the codebase you defend,
    how to patch, and how to win. Call once at the very start, then defend."""
    await runtime.bus.emit(envelope("orchestrator", "handoff", {"from": "orchestrator", "to": "blue"},
                                    round_=runtime.rounds.round))
    return {
        "briefing": _briefing(),
        "codebase": config.APP_DIR,
        "round_budget": runtime.rounds.budget,
        "first_move": "Call get_intel, read the source for that area, fix the flaw, then submit_patch(vuln_id).",
    }


async def get_intel() -> dict[str, Any]:
    """The general area RED is targeting this turn, plus the candidate vulns in
    that area (id + title) from the public board. Free — this is intel we hand you.
    """
    area = ""
    try:
        c = await runtime.http_client()
        r = await c.get(f"{config.ORCH_URL}/hint")
        if r.status_code == 200:
            area = (r.json() or {}).get("area", "") or ""
    except Exception:
        area = ""
    nodes = [n for n in runtime.load_manifest() if not n.get("isDecoy")]
    cands = [n for n in nodes if not area or _area_match(n.get("area", ""), area)]
    if not cands:  # area didn't match a board node — hand the full board
        cands = nodes
    candidates = [{"id": n.get("id"), "title": n.get("title"),
                   "area": n.get("area"), "difficulty": n.get("difficulty")} for n in cands]
    return {
        "area": area or "unknown",
        "candidates": candidates,
        "note": "RED is targeting this area. Read the source behind these, find the flaw, "
                "fix it (keep the feature working), then submit_patch(vuln_id).",
        "budget_remaining": runtime.rounds.remaining(),
    }


async def submit_patch(vuln_id: str, summary: str = "") -> dict[str, Any]:
    """Submit your source fix to the judge. Edit the code FIRST, then call this.
    The judge restarts the app with your edit and confirms the exploit no longer
    lands AND the feature still works. Costs 1.
    """
    err = _charge()
    if err:
        return err
    try:
        c = await runtime.http_client()
        r = await c.post(f"{config.ORCH_URL}/patch", json={"vulnId": vuln_id})
        data = r.json()
    except Exception as exc:
        return {"error": "orchestrator_unreachable", "detail": str(exc),
                "hint": "Is the control plane up on :4100? Your edit is on disk; retry submit_patch."}
    if isinstance(data, dict) and data.get("error"):
        return {"vuln_id": vuln_id, "error": data["error"], "detail": data}
    verdict = (data or {}).get("verdict", data) if isinstance(data, dict) else {}
    valid = bool(verdict.get("valid"))
    return {
        "vuln_id": vuln_id,
        "summary": summary or vuln_id,
        "valid": valid,
        "exploit_still_works": verdict.get("exploitStillWorks"),
        "feature_broken": verdict.get("featureBroken"),
        "reasoning": verdict.get("reasoning"),
        "outcome": "SAVE — patch confirmed (exploit dead, feature alive)" if valid
                   else "REJECTED — fix did not hold (still exploitable or feature broke)",
        "verdict": verdict,
        "budget_remaining": runtime.rounds.remaining(),
    }


async def get_board() -> dict[str, Any]:
    """The live board: scores, whose turn, and which vulns are open/scored/saved. Free."""
    try:
        c = await runtime.http_client()
        r = await c.get(f"{config.ORCH_URL}/state")
        return r.json() if r.status_code == 200 else {"error": "no_state", "status": r.status_code}
    except Exception as exc:
        return {"error": "orchestrator_unreachable", "detail": str(exc)}


# --- automatic per-call reporting + clock + stop-gate ----------------------
def _describe_call(tool: str, p: dict[str, Any]) -> str:
    return {
        "init_defender": "reading the briefing, taking the field",
        "get_intel": "pulling intel on the area RED is hitting",
        "submit_patch": f"submitting a patch for {p.get('vuln_id', 'a vuln')}",
        "get_board": "checking the scoreboard",
    }.get(tool, f"using {tool}")


def _summarize_result(tool: str, r: Any) -> Optional[str]:
    if not isinstance(r, dict):
        return None
    if r.get("error"):
        return f"{tool}: {r['error']}"
    if tool == "get_intel":
        return f"RED is on '{r.get('area')}' — {len(r.get('candidates', []))} candidate(s)"
    if tool == "submit_patch":
        return "SAVE — patch held!" if r.get("valid") else "patch rejected"
    if tool == "get_board":
        return "board checked"
    return None


def _result_detail(tool: str, r: Any) -> dict[str, Any]:
    """The substance of BLUE's move — the patch verdict, the area intel — so the
    caster can explain the defense, not just say 'patch rejected'."""
    if not isinstance(r, dict):
        return {}
    d: dict[str, Any] = {}
    try:
        if tool == "submit_patch":
            d["vuln"] = r.get("vuln_id")
            d["valid"] = bool(r.get("valid"))
            if r.get("exploit_still_works"):
                d["exploitStillWorks"] = True
            if r.get("feature_broken"):
                d["featureBroken"] = True
            reason = r.get("reasoning")
            if reason:
                d["bodySnippet"] = str(reason)[:240]
        elif tool == "get_intel":
            d["bodySnippet"] = f"RED targeting '{r.get('area')}' — {len(r.get('candidates', []))} candidate vuln(s)"
    except Exception:
        pass
    return {k: v for k, v in d.items() if v not in (None, "")}


def auto_report(fn):
    """Wrap a tool so every call narrates intent + outcome to the broadcast,
    stamps the match clock into the result, and refuses once the turn is over."""
    sig = inspect.signature(fn)
    try:
        hints = get_type_hints(fn)
        resolved = sig.replace(parameters=[
            p.replace(annotation=hints.get(name, p.annotation))
            for name, p in sig.parameters.items()
        ])
    except Exception:
        hints, resolved = {}, sig

    @wraps(fn)
    async def wrapper(*args, **kwargs):
        tool = fn.__name__
        # Stop rule: once the turn is over, NOTHING runs (only init_defender is
        # exempt) — the model cannot keep patching/submitting past the buzzer.
        if tool != "init_defender" and runtime.rounds.turn_over():
            return {"error": _turn_over_reason(), "match": runtime.rounds.status(0.0),
                    "hint": "Turn over. Stop now — no more tools, edits, or text."}
        try:
            bound = sig.bind(*args, **kwargs)
            bound.apply_defaults()
            params = dict(bound.arguments)
        except Exception:
            params = dict(kwargs)
        intent_detail = {"vuln": params.get("vuln_id")} if params.get("vuln_id") else {}
        intent_detail.update(_budget_now())  # pre-call budget (this call not charged yet)
        await _emit("attempting", {"agent": "blue", "tool": tool, "target": config.APP_DIR,
                                   "note": _describe_call(tool, params), "phase": "intent",
                                   "detail": intent_detail})
        t0 = time.perf_counter()
        result = await fn(*args, **kwargs)
        tool_ms = (time.perf_counter() - t0) * 1000.0
        if isinstance(result, dict):
            result["match"] = runtime.rounds.status(tool_ms)
        outcome = _summarize_result(tool, result)
        if outcome:
            detail = _result_detail(tool, result)
            detail.setdefault("ms", round(tool_ms, 1))
            detail.update(_budget_now())  # post-call budget — what the HUD counts down
            await _emit("attempting", {"agent": "blue", "tool": tool, "target": config.APP_DIR,
                                       "note": outcome, "phase": "result", "detail": detail})
        return result

    wrapper.__signature__ = resolved
    if hints:
        wrapper.__annotations__ = dict(hints)
    return wrapper
