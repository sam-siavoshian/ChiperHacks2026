"""Offline tests for the session tap parser. Pure string -> envelopes, no process,
no network. Run: python -m runner.test_tap"""

from __future__ import annotations

import json

from .tap import parse_stream_line


def _line(content: list) -> str:
    return json.dumps({"type": "assistant", "message": {"role": "assistant", "content": content}})


checks: list[tuple[str, bool]] = []


def ok(name: str, cond: bool) -> None:
    checks.append((name, bool(cond)))


# 1. assistant text -> agent.thinking on the RED rail (attacker side)
evs = parse_stream_line(_line([{"type": "text", "text": "I'll feed a UNION into the search filter."}]),
                        side="attacker", round_=2)
ok("text -> single thinking event", len(evs) == 1)
ok("thinking type", evs and evs[0]["type"] == "agent.thinking")
ok("red lane agent", evs and evs[0]["agent"] == "web_exploit")
ok("thinking text preserved", evs and "UNION into the search filter" in evs[0]["payload"]["text"])
ok("thinking round propagated", evs and evs[0]["round"] == 2)
ok("thinking kind reason", evs and evs[0]["payload"]["kind"] == "reason")

# 2. extended-thinking block also becomes agent.thinking
evs = parse_stream_line(_line([{"type": "thinking", "thinking": "The login route concatenates the email."}]),
                        side="attacker", round_=1)
ok("thinking block -> thinking event", len(evs) == 1 and evs[0]["type"] == "agent.thinking")
ok("thinking block text", evs and "concatenates the email" in evs[0]["payload"]["text"])

# 3. arena-MCP tool_use is SKIPPED (the MCP self-reports those, richer)
evs = parse_stream_line(_line([{"type": "tool_use", "name": "mcp__arena-attacker__http_request",
                                "input": {"path": "/api/search"}}]), side="attacker", round_=1)
ok("arena tool_use skipped", evs == [])

# 4. BLUE reading source -> attempting on the blue lane with the file
evs = parse_stream_line(_line([{"type": "tool_use", "name": "Read",
                                "input": {"file_path": "/repo/arena/app/server/routes/auth.ts"}}]),
                        side="defender", round_=3)
ok("native Read -> one attempting", len(evs) == 1 and evs[0]["type"] == "attempting")
ok("blue lane agent", evs and evs[0]["agent"] == "blue")
ok("read note", evs and evs[0]["payload"]["note"] == "reading auth.ts")
ok("read detail file basename", evs and evs[0]["payload"]["detail"]["file"] == "auth.ts")
ok("attempting phase intent", evs and evs[0]["payload"]["phase"] == "intent")

# 5. BLUE editing source -> attempting carries the new code (truncated)
big = "x" * 500
evs = parse_stream_line(_line([{"type": "tool_use", "name": "Edit",
                                "input": {"file_path": "/repo/auth.ts", "new_string": big}}]),
                        side="defender", round_=3)
ok("native Edit -> attempting", len(evs) == 1 and evs[0]["payload"]["note"] == "editing auth.ts")
ok("edit payload truncated", evs and len(evs[0]["payload"]["detail"]["payload"]) <= 200)

# 6. Bash command surfaced
evs = parse_stream_line(_line([{"type": "tool_use", "name": "Bash", "input": {"command": "grep -n role auth.ts"}}]),
                        side="defender", round_=1)
ok("bash note", evs and evs[0]["payload"]["note"].startswith("running:"))
ok("bash payload", evs and evs[0]["payload"]["detail"]["payload"] == "grep -n role auth.ts")

# 7. text + tool_use in one message -> two events, in order
evs = parse_stream_line(_line([{"type": "text", "text": "Let me read the auth route."},
                               {"type": "tool_use", "name": "Read", "input": {"file_path": "auth.ts"}}]),
                        side="defender", round_=1)
ok("mixed content -> two events", len(evs) == 2)
ok("mixed order: thinking first", evs and evs[0]["type"] == "agent.thinking" and evs[1]["type"] == "attempting")

# 8. malformed / non-assistant / empty lines yield nothing
ok("malformed json -> []", parse_stream_line("not json {", side="attacker", round_=1) == [])
ok("empty line -> []", parse_stream_line("", side="attacker", round_=1) == [])
ok("user message -> []", parse_stream_line(json.dumps({"type": "user", "message": {"content": []}}),
                                           side="attacker", round_=1) == [])
ok("result message -> []", parse_stream_line(json.dumps({"type": "result", "result": "done"}),
                                             side="attacker", round_=1) == [])

# 9. long reasoning is truncated to keep captions one line
evs = parse_stream_line(_line([{"type": "text", "text": "word " * 300}]), side="attacker", round_=1)
ok("long thinking truncated <=400", evs and len(evs[0]["payload"]["text"]) <= 400)

# 10. whitespace-only text block is dropped
ok("blank text dropped", parse_stream_line(_line([{"type": "text", "text": "   \n  "}]),
                                           side="attacker", round_=1) == [])


def main() -> int:
    passed = sum(1 for _, c in checks if c)
    for name, c in checks:
        print(f"  {'✓' if c else '✗'} {name}")
    print(f"\n{passed}/{len(checks)} checks passed.")
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
