"""Match-runner configuration.

The runner is the conductor: it boots the control plane + the two MCP services,
spawns the two Claude Code sessions, drives turn alternation, sets each side's
clock, and frames the broadcast. Everything is env-overridable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO = Path(os.environ.get("ARENA_REPO", str(Path(__file__).resolve().parents[1])))


def _e(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass
class Config:
    # --- services -----------------------------------------------------------
    control_plane: str = _e("ARENA_CONTROL_PLANE", "http://127.0.0.1:4100")
    app_health: str = _e("ARENA_APP", "http://127.0.0.1:4000") + "/api/health"
    attacker_mcp_port: int = int(_e("ARENA_ATTACKER_MCP_PORT", "8811"))
    defender_mcp_port: int = int(_e("ARENA_DEFENDER_MCP_PORT", "8812"))
    # Default straight to the TV ingest so the dashboard always gets events with
    # no narrator dependency. Point at the narrator relay (:8790/emit) to add live
    # commentary: ARENA_BUS=http://127.0.0.1:8790 ARENA_BUS_EMIT_PATH=/emit
    bus: str = _e("ARENA_BUS", "http://127.0.0.1:3100")
    bus_emit_path: str = _e("ARENA_BUS_EMIT_PATH", "/api/events")

    # --- match shape --------------------------------------------------------
    total_rounds: int = int(_e("ARENA_TOTAL_ROUNDS", "6"))     # red+blue pairs
    # Fast-paced sport: short turns keep the broadcast punchy. RED gets a scout report
    # (handed targets) so it strikes in one shot — 45s is plenty and rarely cuts off.
    turn_seconds: float = float(_e("ARENA_TURN_SECONDS", "45"))
    turn_grace_seconds: float = float(_e("ARENA_TURN_GRACE", "25"))  # kill margin past the clock
    warmup_seconds: float = float(_e("ARENA_WARMUP_SECONDS", "10"))  # the generating-screen window
    match_seconds: float = float(_e("ARENA_MATCH_SECONDS", "900"))

    # --- agents -------------------------------------------------------------
    red_model: str = _e("ARENA_RED_MODEL", "claude-opus-4-8")
    blue_model: str = _e("ARENA_BLUE_MODEL", "claude-opus-4-8")

    # --- lifecycle toggles --------------------------------------------------
    start_orchestrator: bool = _e("ARENA_START_ORCH", "1") != "0"
    start_mcps: bool = _e("ARENA_START_MCPS", "1") != "0"

    repo: Path = REPO

    @property
    def bus_emit(self) -> str:
        return f"{self.bus}{self.bus_emit_path}"

    def mcp_server_spec(self, side: str) -> dict:
        """A STDIO MCP server entry for the session's .mcp.json. stdio (local
        subprocess) makes the arena tools available immediately — no slow HTTP
        'connecting' state and no deferred-tool limbo that leaves the model with
        nothing to call."""
        py = str(self.repo / ".venv" / "bin" / "python")
        # Claude Code's .mcp.json does NOT honor a per-server "cwd", so it spawns the
        # server from the SESSION cwd where `attacker`/`defender` aren't importable ->
        # ModuleNotFoundError -> the MCP stays "pending" forever and the model gets no
        # tools. PYTHONPATH (which Claude Code DOES pass through "env") makes `-m
        # attacker.server` resolve from any cwd. This is the fix for "RED does nothing".
        env = {"ARENA_BUS": self.bus, "ARENA_BUS_EMIT_PATH": self.bus_emit_path,
               "PYTHONPATH": str(self.repo)}
        if side == "attacker":
            env.update({"ARENA_TARGET": "http://127.0.0.1:4000",
                        "ARENA_JUDGE_URL": f"{self.control_plane}/claim",
                        "ARENA_LEAN_TOOLS": "1"})  # 6 tools -> loaded directly, not deferred
        else:
            env.update({"ARENA_CONTROL_PLANE": self.control_plane, "ARENA_REPO": str(self.repo)})
        return {"command": py, "args": ["-m", f"{side}.server"], "cwd": str(self.repo), "env": env}

    @property
    def attacker_mcp_url(self) -> str:
        return f"http://127.0.0.1:{self.attacker_mcp_port}/mcp"

    @property
    def defender_mcp_url(self) -> str:
        return f"http://127.0.0.1:{self.defender_mcp_port}/mcp"

    # In HTTP mode the control routes live on the MCP port (same server).
    @property
    def attacker_control(self) -> str:
        return f"http://127.0.0.1:{self.attacker_mcp_port}"

    @property
    def defender_control(self) -> str:
        return f"http://127.0.0.1:{self.defender_mcp_port}"
