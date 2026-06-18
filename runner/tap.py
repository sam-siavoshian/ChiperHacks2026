"""The session tap — lifts the agent's MIND off its live Claude Code stream.

The runner already runs each side as `claude -p --output-format stream-json`, which
emits newline-delimited JSON: the assistant's reasoning text, its tool calls (with
real args), and tool results. We were dumping that into a dead logfile. This taps
it instead and turns it into broadcast events the caster can talk over:

  - assistant TEXT / THINKING blocks  -> `agent.thinking`  (what it is reasoning)
  - native tool_use (Read/Edit/Bash)  -> `attempting`      (BLUE's source surgery,
                                                             invisible to the MCP)
  - arena-MCP tool_use                -> SKIPPED (the MCP self-reports those, richer)

`parse_stream_line` is pure (string -> list of envelopes) so it unit-tests with no
process and no network. `StreamTap.feed` wraps it with the emit side-effect. Every
step is best-effort: a malformed line, a giant blob, a dead bus — none of it may
break the turn the agent is taking.
"""

from __future__ import annotations

import json
import os
from typing import Any, Awaitable, Callable, Optional

from .clients import envelope

# red side narrates under a generic red lane; the TV reducer only checks `== "blue"`
# to pick the rail, and the narrator does the same to pick the side.
_RED_AGENT = "web_exploit"
_BLUE_AGENT = "blue"

# arena MCP tools self-report through their own auto_report wrapper with structured
# detail; re-emitting them from the stream would double every red move.
_ARENA_PREFIXES = ("mcp__arena", "mcp__arena-attacker", "mcp__arena-defender")

_MAX_THINK = 400   # chars of reasoning prose per line
_MAX_PAYLOAD = 200  # chars of a native tool's argument (the edit text, the command)


def _clip(s: Any, n: int) -> str:
    t = str(s or "").strip()
    t = " ".join(t.split())  # collapse whitespace/newlines so captions stay one line
    return t[:n]


def _base(path: Any) -> str:
    p = str(path or "")
    return os.path.basename(p) or p


def _native_attempt(name: str, inp: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Map a native (non-arena) tool call to a (note, detail) for the broadcast.
    This is how BLUE's file surgery — reading auth.ts, rewriting the query — stops
    being a black box."""
    n = name.lower()
    if n in ("read", "notebookread"):
        f = _base(inp.get("file_path") or inp.get("path") or inp.get("notebook_path"))
        return f"reading {f}", {"file": f}
    if n in ("edit", "multiedit", "write", "notebookedit", "update"):
        f = _base(inp.get("file_path") or inp.get("path") or inp.get("notebook_path"))
        payload = _clip(inp.get("new_string") or inp.get("content") or inp.get("new_source"), _MAX_PAYLOAD)
        d: dict[str, Any] = {"file": f}
        if payload:
            d["payload"] = payload
        return f"editing {f}", d
    if n == "bash":
        cmd = _clip(inp.get("command"), _MAX_PAYLOAD)
        return f"running: {cmd}" if cmd else "running a shell command", ({"payload": cmd} if cmd else {})
    if n in ("grep", "glob", "search"):
        pat = _clip(inp.get("pattern") or inp.get("query"), 120)
        return f"searching the source for {pat}" if pat else "searching the source", ({"payload": pat} if pat else {})
    return f"using {name}", {}


def parse_stream_line(line: str, *, side: str, round_: int) -> list[dict[str, Any]]:
    """Parse ONE stream-json line into zero or more broadcast envelopes. Pure:
    no I/O, never raises. `side` is "attacker" or "defender"."""
    raw = (line or "").strip()
    if not raw:
        return []
    try:
        obj = json.loads(raw)
    except Exception:
        return []
    if not isinstance(obj, dict) or obj.get("type") != "assistant":
        return []  # only the agent's own turns carry mind + tool calls
    msg = obj.get("message")
    if not isinstance(msg, dict):
        return []
    content = msg.get("content")
    if not isinstance(content, list):
        return []

    agent = _BLUE_AGENT if side == "defender" else _RED_AGENT
    out: list[dict[str, Any]] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        btype = block.get("type")
        if btype in ("text", "thinking"):
            text = _clip(block.get("text") if btype == "text" else block.get("thinking"), _MAX_THINK)
            if text:
                out.append(envelope(agent, "agent.thinking",
                                    {"agent": agent, "text": text, "kind": "reason"}, round_=round_))
        elif btype == "tool_use":
            name = str(block.get("name") or "")
            if name.startswith(_ARENA_PREFIXES):
                continue  # MCP self-reports these with better structured detail
            inp = block.get("input")
            inp = inp if isinstance(inp, dict) else {}
            note, detail = _native_attempt(name, inp)
            out.append(envelope(agent, "attempting",
                                {"agent": agent, "tool": name, "target": detail.get("file", ""),
                                 "note": note, "phase": "intent", "detail": detail}, round_=round_))
    return out


class StreamTap:
    """Feeds raw stream-json lines through `parse_stream_line` and emits the
    resulting envelopes. One per side. `round_` is updated by the match driver
    before each turn so events carry the right round."""

    def __init__(self, side: str, emit: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        self.side = side
        self._emit = emit
        self.round_ = 0
        self.emitted = 0

    async def feed(self, line: bytes | str) -> None:
        if isinstance(line, bytes):
            try:
                line = line.decode("utf-8", "replace")
            except Exception:
                return
        for env in parse_stream_line(line, side=self.side, round_=self.round_):
            try:
                await self._emit(env)
                self.emitted += 1
            except Exception:
                pass
