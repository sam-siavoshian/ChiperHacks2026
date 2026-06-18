"""Scripted stand-in agents for a real match without burning model tokens.

RED lands the login SQLi and claims it; BLUE parameterizes the login query in the
actual source and submits the patch. Real exploit + real patch against the live
judge — only the model is replaced by a script. Used by the runner selftest and by
the runner service in ARENA_MOCK_AGENTS mode.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
AUTH = REPO / "arena" / "app" / "server" / "routes" / "auth.ts"
_VULN = ("`SELECT id, email, name, role FROM users WHERE email = '${email}' "
         "AND password_hash = '${hashed}'`")
_FIX = '"SELECT id, email, name, role FROM users WHERE email = ? AND password_hash = ?"'

# The tool layers read env at import; point them at the live arena before importing.
os.environ.setdefault("ARENA_TARGET", "http://127.0.0.1:4000")
os.environ.setdefault("ARENA_JUDGE_URL", "http://127.0.0.1:4100/claim")
os.environ.setdefault("ARENA_CONTROL_PLANE", "http://127.0.0.1:4100")


async def red_mock(prompt: str):
    import attacker.runtime as AR
    import attacker.tools as A
    AR.rounds.start_match(180, 6, 45)
    AR.rounds.start_round(1, target="http://127.0.0.1:4000")
    await A.http_request("POST", "/api/auth/login",
                         body={"email": "x' OR '1'='1' -- ", "password": "nope"})
    return await A.claim_exploit("sqli", "/api/auth/login",
                                 "SQLi mints an admin session with a wrong password")


async def blue_mock(prompt: str):
    import defender.runtime as DR
    import defender.tools as D
    DR.rounds.start_match(180, 6, 45)
    DR.rounds.start_round(1)
    backup = AUTH.read_text()
    patched = backup.replace(_VULN, _FIX) if _VULN in backup else re.sub(
        r"`SELECT id, email, name, role FROM users WHERE email = '\$\{email\}' AND password_hash = '\$\{hashed\}'`",
        _FIX, backup)
    patched = patched.replace(".get() as any", ".get(email, hashed) as any")
    AUTH.write_text(patched)
    try:
        return await D.submit_patch("sqli-login", "parameterized the login query")
    finally:
        AUTH.write_text(backup)
