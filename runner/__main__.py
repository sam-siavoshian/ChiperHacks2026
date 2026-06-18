"""Run a full Arena match.

  python -m runner                 # full match, real Claude sessions
  python -m runner --rounds 3      # shorter
  python -m runner --no-orchestrator   # reuse an already-running control plane

Boots the control plane + the two HTTP MCP services, spawns the attacker (RED) and
defender (BLUE) Claude Code sessions, drives the turn loop, and tears everything
down on exit.
"""

from __future__ import annotations

import argparse
import asyncio
import tempfile

import httpx

from .config import Config
from .match import MatchRunner
from .processes import ProcManager
from .session import AgentSession


async def amain(args: argparse.Namespace) -> None:
    cfg = Config()
    if args.rounds:
        cfg.total_rounds = args.rounds
    if args.turn_seconds:
        cfg.turn_seconds = args.turn_seconds
    if args.no_orchestrator:
        cfg.start_orchestrator = False

    procs = ProcManager(cfg)
    async with httpx.AsyncClient(timeout=20.0) as http:
        try:
            await procs.start_orchestrator()
            await procs.start_mcps()
            red = AgentSession("attacker", cfg.red_model, cfg.mcp_server_spec("attacker"),
                               cfg.repo / "attacker" / "launch" / "system_prompt.txt",
                               cfg.repo / "attacker" / "launch" / "settings.json",
                               cwd=tempfile.mkdtemp(prefix="arena-red."))
            blue = AgentSession("defender", cfg.blue_model, cfg.mcp_server_spec("defender"),
                                cfg.repo / "defender" / "launch" / "system_prompt.txt",
                                cfg.repo / "defender" / "launch" / "settings.json",
                                cwd=str(cfg.repo))
            result = await MatchRunner(cfg, http, red, blue).run()
            print("\n=== FINAL ===", result)
        finally:
            procs.stop_all()


def main() -> None:
    ap = argparse.ArgumentParser(description="Arena match runner")
    ap.add_argument("--rounds", type=int, help="number of red+blue rounds")
    ap.add_argument("--turn-seconds", type=float, dest="turn_seconds")
    ap.add_argument("--no-orchestrator", action="store_true", help="reuse a running control plane")
    asyncio.run(amain(ap.parse_args()))


if __name__ == "__main__":
    main()
