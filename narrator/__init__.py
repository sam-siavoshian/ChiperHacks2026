"""CYBER ARENA narrator — the live football-style play-by-play voice.

An inline relay that sits between the arena and the TV broadcast, turning the
event feed into continuous spoken commentary (Anthropic for the words,
ElevenLabs for the voice) and serving the audio the TV plays.
"""

from . import config, engine, llm, tts  # noqa: F401
