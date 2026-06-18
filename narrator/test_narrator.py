"""Offline self-test for the narrator. No network: TTS + LLM are stubbed.

Run:  .venv/bin/python -m narrator.test_narrator
Exits non-zero on the first failure.
"""

import asyncio
import sys

from aiohttp.test_utils import TestClient, TestServer

from . import config, emotion, tts
from .engine import CommentaryEngine, describe
from .llm import _split_emotion
from .server import build_app

_fails = []


def check(name, cond):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}")
    if not cond:
        _fails.append(name)


# -- pure helpers -----------------------------------------------------------
def test_alignment_to_words():
    chars = list("Red wins")
    starts = [0, 40, 80, 130, 200, 240, 280, 320]  # 'R'0 'e'40 'd'80 ' '130 'w'200...
    words = tts._words_from_alignment(chars, starts)
    check("alignment splits into words", [w["w"] for w in words] == ["Red", "wins"])
    check("first word starts at 0", words[0]["t"] == 0)
    check("second word starts at its first char", words[1]["t"] == 200)


def test_fallback_words():
    w = tts._spread_words("a b c d", 1000)
    check("fallback spreads evenly", len(w) == 4 and w[0]["t"] == 0 and w[-1]["t"] == 750)
    check("fallback empty text -> empty", tts._spread_words("   ", 1000) == [])


def test_emotion():
    g = emotion.analyze("GOOOAL! Red cracks the database wide open!")
    check("goal detected from text", g["emotion"] == "goal")
    check("goal leads with [shouting] tag", g["tagged_text"].startswith("[shouting]"))
    check("goal crowd intensity is high", g["intensity"] >= 0.9)
    s = emotion.analyze("Blue patched it and the wall holds")
    check("save detected", s["emotion"] == "save")
    miss = emotion.analyze("Red's attempt fails, no good")
    check("setback detected", miss["emotion"] == "setback" and miss["intensity"] < 0.4)
    # LLM-supplied emotion overrides detection (the partner's hybrid)
    forced = emotion.analyze("a routine line", emotion="goal")
    check("LLM emotion label overrides detection", forced["emotion"] == "goal")
    check("strip_tags removes leading tag", emotion.strip_tags("[excited] go go go") == "go go go")


def test_llm_label_parse():
    check("parses leading [goal] label", _split_emotion("[goal] RED scores!") == ("RED scores!", "goal"))
    check("plain text -> no emotion", _split_emotion("RED probes the API") == ("RED probes the API", None))
    check("unknown bracket left intact", _split_emotion("[foo] bar")[1] is None)


def test_describe():
    big = describe({"type": "exploit_success", "agent": "auth", "payload": {"class": "sqli", "url": "/login", "evidence": "200 admin"}})
    check("exploit_success is a hype goal", big[1] == "hype" and big[2] == "goal" and big[3] is True)
    save = describe({"type": "blue.mitigate", "agent": "blue", "payload": {"label": "auth"}})
    check("blue.mitigate is a hype save", save[2] == "save" and save[3] is True)
    com = describe({"type": "commentary", "agent": "caster", "payload": {"text": "hi", "intensity": "hype", "trigger": "goal"}})
    check("arena commentary fed verbatim", com[0] == "hi" and com[3] is True)
    ignored = describe({"type": "timer", "agent": "orchestrator", "payload": {"secondsLeft": 5}})
    check("timer is ignored as context", ignored[0] is None)
    # the attacker MCP self-report shape (auto_report -> attempting w/ tool+note+area)
    probe = describe({"type": "attempting", "agent": "web_exploit", "payload": {
        "agent": "web_exploit", "tool": "diff_probe", "area": "search / SQL",
        "note": "material difference — likely injectable"}})
    check("MCP attempting carries note+area to the LLM", "material difference" in probe[0] and "search / SQL" in probe[0])
    check("MCP attempting tags the tool", probe[2] == "diff_probe")
    check("MCP hit outcome lifts intensity", probe[1] == "normal")
    # the agent's mind (runner session tap -> agent.thinking)
    mind = describe({"type": "agent.thinking", "agent": "web_exploit",
                     "payload": {"agent": "web_exploit", "text": "The search filter looks injectable.", "kind": "reason"}})
    check("thinking is fed as RED's mind", "RED is thinking" in mind[0] and "injectable" in mind[0])
    check("thinking is low energy, not a goal", mind[1] == "calm" and mind[3] is False)
    blue_mind = describe({"type": "agent.thinking", "agent": "blue",
                          "payload": {"agent": "blue", "text": "Swap to a parameterized query.", "kind": "reason"}})
    check("blue thinking attributed to BLUE", "BLUE is thinking" in blue_mind[0])
    blank = describe({"type": "agent.thinking", "agent": "blue", "payload": {"agent": "blue", "text": "  "}})
    check("blank thinking ignored", blank[0] is None)
    # enriched attempting carries the REAL payload + leaked response into the line
    rich = describe({"type": "attempting", "agent": "web_exploit", "payload": {
        "agent": "web_exploit", "tool": "http_request", "area": "search / SQL", "phase": "result",
        "note": "got 200 (812b)", "detail": {"status": 200, "bodySnippet": "admin@tasklight.io leaked",
                                              "payload": "q=' UNION SELECT email FROM users -- "}}})
    check("attempting surfaces the real payload", "UNION SELECT email" in rich[0])
    check("attempting surfaces the leaked response", "admin@tasklight.io leaked" in rich[0])
    check("leaked response lifts intensity", rich[1] == "normal")
    intent = describe({"type": "attempting", "agent": "web_exploit", "payload": {
        "agent": "web_exploit", "tool": "http_request", "area": "search / SQL", "phase": "intent",
        "note": "firing GET at /api/search", "detail": {"payload": "q=' UNION SELECT ..."}}})
    check("intent beat reads as lining up", "lining up" in intent[0])
    # BLUE's native source surgery (tap -> attempting with a file)
    surgery = describe({"type": "attempting", "agent": "blue", "payload": {
        "agent": "blue", "tool": "Edit", "phase": "intent", "note": "editing auth.ts",
        "detail": {"file": "auth.ts", "payload": "db.query(sql).get(email)"}}})
    check("blue surgery names the file", "auth.ts" in surgery[0] and "BLUE" in surgery[0])


def test_ingest_state():
    eng = CommentaryEngine(forward=lambda e: asyncio.sleep(0))
    eng.ingest({"type": "round_start", "payload": {"round": 2, "redScore": 0, "blueScore": 0, "title": "x"}})
    check("round_start sets live + round", eng.live and eng.round == 2)
    eng.ingest({"type": "score.update", "payload": {"red": 3, "blue": 5, "health": 76}})
    check("score.update folds score", eng.red == 3 and eng.blue == 5 and eng.health == 76)
    eng.ingest({"type": "round_end", "payload": {"summary": "Red 3 - Blue 5", "winner": "blue"}})
    check("round_end clears live", eng.live is False)
    # wake on raw MCP activity even without a round_start (resilient to wiring)
    eng2 = CommentaryEngine(forward=lambda e: asyncio.sleep(0))
    eng2.ingest({"type": "attempting", "agent": "auth", "payload": {"tool": "login", "note": "authenticating as admin"}})
    check("attacker activity wakes the voice", eng2.live is True)


# -- engine end-to-end (stubbed LLM + TTS) ----------------------------------
async def test_engine_pipeline():
    # force LLM-mode on for this test, regardless of real env
    saved = config.OPENAI_API_KEY
    config.OPENAI_API_KEY = "test-key"
    captured = []
    done = asyncio.Event()

    async def fake_forward(env):
        captured.append(env)
        if len([e for e in captured if e["type"] == "commentary"]) >= 2:
            done.set()

    async def fake_tts(text, *, voice_settings=None):
        return (b"FAKEMP3" + text[:4].encode(), [{"t": 0, "w": text.split()[0]}], 60)

    n = 0

    async def fake_llm(*, state_summary, new_action, recent_lines):
        nonlocal n
        n += 1
        return (f"RED storms the auth layer, line {n}, GOAL", "goal")

    eng = CommentaryEngine(forward=fake_forward, tts_fn=fake_tts, llm_fn=fake_llm)
    try:
        eng.ingest({"type": "round_start", "payload": {"round": 1, "redScore": 0, "blueScore": 0, "title": "Kickoff"}})
        eng.start()
        await asyncio.wait_for(done.wait(), timeout=5)
    finally:
        await eng.stop()
        config.OPENAI_API_KEY = saved

    coms = [e for e in captured if e["type"] == "commentary"]
    first = coms[0]
    check("emits commentary events", len(coms) >= 2)
    check("agent is caster", first["agent"] == "caster")
    p = first["payload"]
    check("payload has audioUrl", isinstance(p.get("audioUrl"), str) and "/audio/" in p["audioUrl"])
    check("payload has words", isinstance(p.get("words"), list) and len(p["words"]) >= 1)
    check("payload has durationMs", isinstance(p.get("durationMs"), int) and p["durationMs"] > 0)
    check("payload has caster name", p.get("caster") == config.NARRATOR_NAME)
    check("payload carries emotion", p.get("emotion") == "goal")
    check("payload carries crowd intensity 0..1", isinstance(p.get("crowd"), (int, float)) and p["crowd"] >= 0.9)
    check("goal emotion maps to hype accent", p.get("intensity") == "hype")
    check("clip bytes stored for audio route", eng.clips.get(first["id"]) is not None)


async def test_fallback_voices_arena_commentary():
    # llm OFF, tts ON -> voices the arena's own beat lines verbatim
    saved = config.OPENAI_API_KEY
    config.OPENAI_API_KEY = ""
    captured = []
    done = asyncio.Event()

    async def fake_forward(env):
        captured.append(env)
        done.set()

    async def fake_tts(text, *, voice_settings=None):
        return (b"FAKE", [{"t": 0, "w": "x"}], 40)

    eng = CommentaryEngine(forward=fake_forward, tts_fn=fake_tts)
    try:
        eng.ingest({"type": "commentary", "agent": "caster", "payload": {"text": "GOOOAL Red breaks login", "intensity": "hype", "trigger": "goal"}})
        eng.start()
        await asyncio.wait_for(done.wait(), timeout=5)
    finally:
        await eng.stop()
        config.OPENAI_API_KEY = saved

    check("fallback voices the arena line", captured and captured[0]["payload"]["text"] == "GOOOAL Red breaks login")


# -- HTTP surface -----------------------------------------------------------
async def test_http_surface():
    app = build_app()
    n = app["narrator"]
    forwarded = []
    n._forward_tv = lambda env: forwarded.append(env) or asyncio.sleep(0)

    async with TestClient(TestServer(app)) as client:
        # gameplay event is forwarded
        r = await client.post("/emit", json={"type": "vuln_found", "agent": "web_exploit", "round": 1, "payload": {"class": "sqli", "severity": "high", "url": "/login"}})
        body = await r.json()
        check("gameplay event forwarded", body["forwarded"] == 1)

        # arena commentary is suppressed from direct forward (engine owns it when active)
        r = await client.post("/emit", json={"type": "commentary", "agent": "caster", "round": 1, "payload": {"text": "hi", "intensity": "normal", "trigger": "x"}})
        body = await r.json()
        expect = 0 if n.engine.owns_commentary else 1
        check("arena commentary forwarding matches mode", body["forwarded"] == expect)

        # control passes through
        r = await client.post("/emit", json={"control": "reset"})
        check("control reset ok", (await r.json())["ok"] is True)

        # audio route serves stored clips
        n.engine.clips["nar_test"] = b"AUDIOBYTES"
        r = await client.get("/audio/nar_test.mp3")
        check("audio 200", r.status == 200 and (await r.read()) == b"AUDIOBYTES")
        check("audio content-type", r.headers.get("Content-Type") == "audio/mpeg")

        # range request
        r = await client.get("/audio/nar_test.mp3", headers={"Range": "bytes=0-3"})
        check("audio range 206", r.status == 206 and (await r.read()) == b"AUDI")

        # missing clip
        r = await client.get("/audio/nope.mp3")
        check("audio 404 for missing", r.status == 404)

        # health
        r = await client.get("/healthz")
        check("healthz ok", (await r.json())["ok"] is True)

        # warmup sets meta
        r = await client.post("/warmup", json={"red": {"model": "claude-opus-4-8"}, "blue": {"model": "gpt-5"}})
        check("warmup ok", (await r.json())["ok"] is True)
        check("warmup sets match meta", "claude-opus-4-8" in n.engine.meta)


async def _amain():
    print("narrator self-test")
    print("- pure helpers")
    test_alignment_to_words()
    test_fallback_words()
    test_emotion()
    test_llm_label_parse()
    test_describe()
    test_ingest_state()
    print("- engine pipeline (stubbed)")
    await test_engine_pipeline()
    await test_fallback_voices_arena_commentary()
    print("- http surface")
    await test_http_surface()
    print(f"\n{'ALL GREEN' if not _fails else str(len(_fails)) + ' FAILED: ' + ', '.join(_fails)}")
    return 1 if _fails else 0


def main():
    sys.exit(asyncio.run(_amain()))


if __name__ == "__main__":
    main()
