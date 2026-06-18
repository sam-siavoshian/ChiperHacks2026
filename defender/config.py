"""Runtime configuration for the Arena defender MCP.

The defender (BLUE) lives inside the codebase. Unlike the attacker it makes no
arbitrary network requests — it only talks to the orchestrator control plane
(submit a patch, pull the area hint) and emits narration to the broadcast. It
patches by editing the real source with its native file tools.
"""

from __future__ import annotations

import os
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


# --- control plane + bus ---------------------------------------------------
# The orchestrator/judge (turn alternation, scoring, reset, patch judging).
ORCH_URL = _env("ARENA_CONTROL_PLANE", "http://127.0.0.1:4100").rstrip("/")
ARENA_BUS = _env("ARENA_BUS", "http://127.0.0.1:8790").rstrip("/")   # narrator relay -> TV
BUS_EMIT_PATH = _env("ARENA_BUS_EMIT_PATH", "/emit")

# --- the codebase the defender patches -------------------------------------
REPO_ROOT = Path(_env("ARENA_REPO", str(Path(__file__).resolve().parents[1])))
APP_DIR = _env("ARENA_APP_DIR", str(REPO_ROOT / "arena" / "app"))
# Public board (drives the viz) — areas + titles, NOT the answer sheet.
MANIFEST_PATH = _env("ARENA_MANIFEST", str(REPO_ROOT / "arena" / "contract" / "vuln-manifest.json"))

# --- match clock + budget --------------------------------------------------
ROUND_BUDGET = int(_env("ARENA_ROUND_BUDGET", "6"))
MATCH_SECONDS = float(_env("ARENA_MATCH_SECONDS", "180"))
TURN_SECONDS = float(_env("ARENA_TURN_SECONDS", "45"))
TOTAL_ROUNDS = int(_env("ARENA_TOTAL_ROUNDS", "6"))
HTTP_TIMEOUT = float(_env("ARENA_HTTP_TIMEOUT", "30.0"))

# --- control surface (orchestrator drives the defender's turn clock) -------
CONTROL_HOST = _env("ARENA_DEFENDER_CONTROL_HOST", "127.0.0.1")
CONTROL_PORT = int(_env("ARENA_DEFENDER_CONTROL_PORT", "8792"))
