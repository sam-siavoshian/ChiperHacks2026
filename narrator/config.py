"""Narrator configuration — all env-driven, with sane localhost defaults.

The narrator is an inline relay between the arena and the TV broadcast. It reads
its ElevenLabs key + voice from narrator/.env (gitignored) or the environment,
and the Anthropic key for the play-by-play LLM from the environment.
"""

import os

_HERE = os.path.dirname(os.path.abspath(__file__))


def _load_env_file(path: str) -> None:
    """Tiny .env loader (no dependency). Does not overwrite real env vars."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key, val = key.strip(), val.strip().strip('"').strip("'")
            if val and key not in os.environ:
                os.environ[key] = val


# Load narrator/.env first, then fall back to the partner's voice prototype .env
# if someone runs without copying the key over.
_load_env_file(os.path.join(_HERE, ".env"))

# --- where the narrator sits in the pipeline --------------------------------
# The arena posts every event here (set ARENA_BUS_EMIT on the arena to this).
LISTEN_HOST = os.environ.get("NARRATOR_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("NARRATOR_PORT", "8790"))
# Where we forward events on to (the TV broadcast ingest).
TV_EVENTS_URL = os.environ.get("TV_EVENTS_URL", "http://127.0.0.1:3100/api/events")
# Base URL the browser uses to fetch generated audio clips. Must be reachable
# from the spectator's browser (so a public host if the TV is remote).
PUBLIC_URL = os.environ.get("NARRATOR_PUBLIC_URL", f"http://localhost:{LISTEN_PORT}").rstrip("/")

# --- ElevenLabs TTS ---------------------------------------------------------
ELEVEN_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
# Defaults match the partner's eleven_ws_stream.py prototype.
ELEVEN_VOICE_ID = os.environ.get("ELEVEN_VOICE_ID", "pNInz6obpgDQGcFmaJgB")
ELEVEN_OUTPUT_FORMAT = os.environ.get("ELEVEN_OUTPUT_FORMAT", "mp3_44100_128")

# Two delivery engines:
#   "v3"    — HTTP stream w/ eleven_v3 emotion tags ([shouting]/[excited]/[sad]).
#             The voice reacts to each line. No word-level alignment from the API,
#             so caption word timings are estimated from the clip length.
#   "flash" — low-latency WebSocket (eleven_flash_v2_5) with exact word alignment,
#             but no emotion tags.
# Default flash: cheapest + lowest-latency model, the right call for a live match.
# v3 is far pricier and drains the ElevenLabs quota fast (a single line can cost
# 50+ credits). Set NARRATOR_TTS_ENGINE=v3 for the richer emotional voice when the
# account has credits to spare.
TTS_ENGINE = os.environ.get("NARRATOR_TTS_ENGINE", "flash").lower()
ELEVEN_V3_MODEL = os.environ.get("ELEVEN_V3_MODEL", "eleven_v3")
ELEVEN_FALLBACK_MODEL = os.environ.get("ELEVEN_FALLBACK_MODEL", "eleven_multilingual_v2")
ELEVEN_FLASH_MODEL = os.environ.get("ELEVEN_FLASH_MODEL", "eleven_flash_v2_5")
ELEVEN_HTTP_BASE = os.environ.get("ELEVEN_HTTP_BASE", "https://api.elevenlabs.io")
ELEVEN_BASE_URL = os.environ.get("ELEVEN_BASE_URL", "wss://api.elevenlabs.io")
# mp3_44100_128 is constant-bitrate 16 KB/s, so clip duration ≈ bytes / 16 (ms).
ELEVEN_MP3_BYTES_PER_MS = 16.0
ELEVEN_VOICE_SETTINGS = {
    "stability": float(os.environ.get("ELEVEN_STABILITY", "0.4")),
    "similarity_boost": float(os.environ.get("ELEVEN_SIMILARITY", "0.85")),
    "use_speaker_boost": True,
}
# ElevenLabs' recommended buffering schedule (chars before each flush).
ELEVEN_CHUNK_SCHEDULE = [120, 160, 250, 290]

# --- play-by-play LLM (OpenAI) ----------------------------------------------
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
# SOTA *fast* model = the newest chat-tuned (non-reasoning) GPT. The mini/nano
# tiers are reasoning models that stall first-token — wrong for live commentary.
NARRATOR_MODEL = os.environ.get("NARRATOR_MODEL", "gpt-5.3-chat-latest")
NARRATOR_NAME = os.environ.get("NARRATOR_NAME", "PLAY-BY-PLAY")
LLM_TIMEOUT_S = float(os.environ.get("NARRATOR_LLM_TIMEOUT", "18.0"))
# Cap a line so cadence stays snappy and reactions interleave fast. Enough room
# for a specific, substantive call (endpoint + technique + consequence).
MAX_LINE_WORDS = int(os.environ.get("NARRATOR_MAX_WORDS", "26"))
# Gap of silence after each line (breath). Keeps it "always talking" but human.
LINE_GAP_MS = int(os.environ.get("NARRATOR_LINE_GAP_MS", "180"))
# Don't let the commentator run forever if a match never ends.
MAX_LINES_PER_MATCH = int(os.environ.get("NARRATOR_MAX_LINES", "400"))
# Go quiet after this many seconds with no events AND nothing to react to, so the
# narrator doesn't talk into the void (or burn tokens) between matches.
IDLE_QUIET_S = float(os.environ.get("NARRATOR_IDLE_QUIET_S", "18"))

# Bounded in-memory clip store (id -> mp3 bytes). Evicts oldest beyond this.
CLIP_CACHE_MAX = int(os.environ.get("NARRATOR_CLIP_CACHE", "64"))


def llm_enabled() -> bool:
    return bool(OPENAI_API_KEY)


def tts_enabled() -> bool:
    return bool(ELEVEN_API_KEY)
