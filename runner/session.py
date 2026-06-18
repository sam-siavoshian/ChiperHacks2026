"""Drives one side's Claude Code session across turns.

Real mode spawns `claude -p` headless with the side's sandbox (system prompt,
HTTP MCP config, settings), a fixed session id so turns RESUME the same context,
and a hard wall-clock deadline. Mock mode runs a scripted async callable instead
— used by the selftest to exercise the full turn loop without a live model.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

OnLine = Callable[[bytes], Awaitable[None]]

# Low reasoning effort = the model acts instead of deliberating. Overridable.
EFFORT = os.environ.get("ARENA_EFFORT", "low")


class AgentSession:
    def __init__(self, side: str, model: str, mcp_server: dict,
                 system_prompt_path: Optional[Path], settings_path: Optional[Path],
                 cwd: str, mock: Optional[Callable[[str], Awaitable[Any]]] = None) -> None:
        self.side = side
        self.model = model
        self.cwd = cwd
        self.mock = mock
        self.session_id = str(uuid.uuid4())
        self.started = False
        self.system_prompt = system_prompt_path.read_text() if system_prompt_path and system_prompt_path.exists() else ""
        self.settings_path = str(settings_path) if settings_path else None
        # STDIO MCP: the session spawns the arena server locally, so the tools are
        # available immediately (no HTTP connecting delay / deferred-tool limbo).
        self.mcp_config = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False).name
        json.dump({"mcpServers": {f"arena-{side}": mcp_server}}, open(self.mcp_config, "w"))
        self.log_path = f"/tmp/arena-session-{side}.log"

    async def take_turn(self, prompt: str, deadline_seconds: float,
                        on_line: Optional[OnLine] = None) -> dict[str, Any]:
        if self.mock is not None:
            r = await self.mock(prompt)
            return {"status": "mock", "result": r}

        cmd = ["claude", "-p", prompt, "--model", self.model, "--effort", EFFORT,
               "--mcp-config", self.mcp_config, "--strict-mcp-config",
               # Drop the user's GLOBAL settings (hooks like CAVEMAN/jarvis) and
               # global MCP servers — keep only this match's arena server + auth.
               "--setting-sources", "project",
               "--permission-mode", "acceptEdits",
               "--output-format", "stream-json", "--verbose"]
        if self.settings_path:
            cmd += ["--settings", self.settings_path]
        if self.system_prompt:
            cmd += ["--system-prompt", self.system_prompt]
        cmd += (["--resume", self.session_id] if self.started else ["--session-id", self.session_id])
        self.started = True

        # Pipe stdout so the session tap can read the agent's mind LIVE (and still
        # tee every line to the logfile for debugging). stderr folds into the same
        # stream. If no tap is wired, this behaves like the old logfile dump.
        log = open(self.log_path, "a")
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, cwd=self.cwd,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        except FileNotFoundError:
            log.close()
            return {"status": "no_claude_cli"}

        async def pump() -> None:
            assert proc.stdout is not None
            async for raw in proc.stdout:
                try:
                    log.write(raw.decode("utf-8", "replace"))
                    log.flush()
                except Exception:
                    pass
                if on_line is not None:
                    try:
                        await on_line(raw)
                    except Exception:
                        pass  # the tap must never break the turn
            await proc.wait()

        try:
            await asyncio.wait_for(pump(), timeout=deadline_seconds)
            return {"status": "done", "code": proc.returncode}
        except asyncio.TimeoutError:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            return {"status": "timeout"}
        finally:
            log.close()
