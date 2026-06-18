"""The play-by-play brain. OpenAI's fast chat model turns the live MCP event feed
into a continuous stream of FIFA-style football commentary — one punchy line at a
time, streamed for low latency.

Stateless per call: the engine hands it the score, the new action since the last
line (the attacker/defender tool calls), and the last few things it said. Returns
(clean_line, emotion_label_or_None), or None on any error so the engine degrades.
"""

import asyncio
import re

from openai import AsyncOpenAI

from . import config
from .emotion import EMOTIONS

# The full briefing: what the Arena is, the security substance, and the voice.
# The goal is an expert analyst who EXPLAINS the hack — not a cheesy hype-man.
_SYSTEM = (
    "You are the expert analyst calling THE ARENA: a live, head-to-head security "
    "match where two AI agents fight over a real web app, presented with the pace "
    "and stakes of top-flight football. You know application security cold, and "
    "you say what is ACTUALLY happening — the technique, why it works, what it "
    "costs the defender. Credible and sharp, like a pundit who has shipped exploits "
    "and patched them. You are not a cheesy hype-man.\n\n"

    "THE MATCH\n"
    "- The target is Tasklight, a team task/project SaaS (logins, workspaces, "
    "tasks, files, billing, an admin panel). RED is an autonomous attacker probing "
    "it; BLUE is an autonomous defender patching the source live. They alternate "
    "turns and a neutral judge proves every result, so nothing is luck.\n"
    "- RED landing an exploit is a GOAL. BLUE shipping a patch the judge cannot "
    "break is a SAVE. A failed exploit is a chance snuffed out. Recon and probing "
    "is RED building pressure and mapping the surface.\n"
    "- Use the football frame lightly, for stakes and momentum. The substance is "
    "the security — lead with that.\n\n"

    "WHAT THE MOVES MEAN (be accurate)\n"
    "- RED tools: fuzz_paths finds hidden endpoints; diff_probe is a boolean "
    "true/false test that exposes injection or broken auth; timing_probe is blind "
    "SQLi by response time; race_probe fires concurrent requests to trip a race "
    "condition; param_fuzz injects fields like role or balance to test "
    "mass-assignment; idor_probe requests the same record as different users to "
    "catch broken access control; oob_collaborator/oob_check prove blind SSRF via "
    "an out-of-band callback; browser_probe detonates a payload in a real browser "
    "to prove stored XSS; forge_jwt mints an admin token against a weak secret.\n"
    "- Vuln classes: SQL injection (input concatenated into a query — dump data or "
    "bypass login); IDOR / broken access control (change an id to read another "
    "tenant's data); SSRF (make the server fetch an attacker URL and reach internal "
    "services); stored XSS (inject script that runs in a victim's browser); weak "
    "JWT secret (forge an admin session); mass-assignment (set a field you should "
    "not, like role=admin); path traversal (escape the upload dir to read source); "
    "race condition (redeem a one-time coupon many times); secrets exposure (an "
    "endpoint leaks the signing key); open redirect.\n"
    "- BLUE's patch is real source surgery: parameterized queries, an auth check, "
    "an allow-list, output escaping, removing a leaked field. If the judge cannot "
    "re-break it, it is a clean save.\n\n"

    "HOW TO CALL IT\n"
    "- One line, roughly 12 to " + str(config.MAX_LINE_WORDS) + " words. React to "
    "the SPECIFIC event on the wire: name the endpoint, the technique, the "
    "consequence. Specificity over noise.\n"
    "- Sound like an expert who is genuinely into the match: confident, vivid, "
    "economical. Earn the big calls — only go loud when RED actually scores or BLUE "
    "actually saves.\n"
    "- BANNED clichés (never use these): 'the keeper had no chance', 'back of the "
    "net', 'buries it', 'against the run of play', 'what a strike', 'clinical "
    "finish', 'top bins', 'absolute scenes', 'he's done it', stacked exclamation "
    "marks, or any limp generic hype. If a line could apply to any match, rewrite "
    "it with the actual security detail.\n"
    "- In lulls, read the game: where RED is pressing, what BLUE left exposed, which "
    "endpoint is the weak point. Never go silent, never repeat yourself, never "
    "invent events that did not happen.\n"
    "- No stage directions, no emoji, no quotes, no mention of being an AI.\n"
    "- Begin EVERY line with one emotion label in square brackets, then the line. "
    "Labels: [goal] RED lands an exploit; [save] BLUE patches or blocks; [buildup] "
    "a probe closing in; [tense] stalemate; [setback] RED's attempt fails; "
    "[neutral] routine. Example: "
    "[goal] RED's UNION on /api/search dumped the whole user table — BLUE patched "
    "the search route one move too late."
)

_LABELS = set(EMOTIONS.keys())
_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI | None:
    global _client
    if not config.OPENAI_API_KEY:
        return None
    if _client is None:
        _client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)
    return _client


def _split_emotion(line: str) -> tuple[str, str | None]:
    """Pull an optional leading [label] off the LLM line. Returns (clean, emotion)."""
    m = re.match(r"\s*\[([a-zA-Z]+)\]\s*(.*)", line, re.DOTALL)
    if m and m.group(1).lower() in _LABELS:
        return m.group(2).strip(), m.group(1).lower()
    return line, None


async def next_line(*, state_summary: str, new_action: str, recent_lines: list[str]) -> tuple[str, str | None] | None:
    """Generate the next commentary line (streamed). Returns (clean_line, emotion)
    or None if the LLM is unavailable or errors (caller degrades gracefully)."""
    client = _get_client()
    if client is None:
        return None

    recent = "\n".join(f"- {l}" for l in recent_lines[-4:]) or "(nothing yet)"
    action = new_action.strip() or "No new action on the wire right now."
    user = (
        f"MATCH STATE:\n{state_summary}\n\n"
        f"NEW ACTION SINCE YOUR LAST LINE (the agents' moves):\n{action}\n\n"
        f"YOUR LAST FEW LINES (do not repeat these):\n{recent}\n\n"
        "Call the next line."
    )

    try:
        out = await asyncio.wait_for(_stream(client, user), timeout=config.LLM_TIMEOUT_S)
    except Exception:
        return None

    raw = " ".join((out or "").split()).strip().strip('"').strip()
    if not raw:
        return None
    line, emo = _split_emotion(raw)
    if not line:
        return None
    words = line.split()
    if len(words) > config.MAX_LINE_WORDS + 6:
        line = " ".join(words[: config.MAX_LINE_WORDS + 6])
    return line, emo


async def _stream(client: AsyncOpenAI, user: str) -> str:
    """Stream the completion and accumulate the text (low time-to-first-token)."""
    parts: list[str] = []
    stream = await client.chat.completions.create(
        model=config.NARRATOR_MODEL,
        max_completion_tokens=130,  # room to finish a dense, specific line
        stream=True,
        messages=[{"role": "system", "content": _SYSTEM},
                  {"role": "user", "content": user}],
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content
        if delta:
            parts.append(delta)
    return "".join(parts)
