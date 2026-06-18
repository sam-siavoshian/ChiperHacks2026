"""ElevenLabs TTS — text in, audio + word timings out. Two engines:

  v3    — HTTP stream with eleven_v3 emotion tags so the delivery reacts to each
          line (shouts a goal, dejected on a miss). No alignment from the API, so
          word timings are estimated from the clip length. v3 -> multilingual_v2
          fallback if v3 isn't available (tags stripped). This is the default.
  flash — low-latency WebSocket (eleven_flash_v2_5) that streams exact character
          alignment, so caption words track the voice precisely — but no emotion.

Both return (audio_bytes, words, duration_ms), where `words` is
[{ "t": <ms from clip start>, "w": <word> }] ready for the broadcast caption.

The emotion classification + the tag live in emotion.py; here we just speak the
(already-tagged) text with the given voice settings.
"""

import asyncio
import base64
import json

import aiohttp
import websockets

from . import config, emotion


# ---------------------------------------------------------------------------
# word-timing helpers
# ---------------------------------------------------------------------------
def _words_from_alignment(chars, starts):
    words, cur, cur_start = [], "", None
    for ch, t in zip(chars, starts):
        if ch.isspace():
            if cur:
                words.append({"t": int(cur_start or 0), "w": cur})
                cur, cur_start = "", None
            continue
        if cur_start is None:
            cur_start = t
        cur += ch
    if cur:
        words.append({"t": int(cur_start or 0), "w": cur})
    return words


def _spread_words(text, duration_ms):
    toks = [w for w in text.split() if w]
    if not toks:
        return []
    step = max(1, duration_ms // max(1, len(toks)))
    return [{"t": int(i * step), "w": w} for i, w in enumerate(toks)]


# ---------------------------------------------------------------------------
# v3 — emotion-tagged HTTP stream (default)
# ---------------------------------------------------------------------------
async def _synthesize_v3(text, *, voice_settings, voice_id, api_key, output_format):
    """Speak `text` (which may lead with a v3 tag) with emotion. Retries on a
    non-tag model if v3 is unavailable. Returns (audio, words, duration_ms)."""
    base = config.ELEVEN_HTTP_BASE
    url = f"{base}/v1/text-to-speech/{voice_id}/stream?output_format={output_format}"
    attempts = [(config.ELEVEN_V3_MODEL, text)]
    if config.ELEVEN_FALLBACK_MODEL != config.ELEVEN_V3_MODEL:
        attempts.append((config.ELEVEN_FALLBACK_MODEL, emotion.strip_tags(text)))

    headers = {"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"}
    timeout = aiohttp.ClientTimeout(total=90)
    last_err = None
    async with aiohttp.ClientSession(timeout=timeout) as s:
        for i, (model, send_text) in enumerate(attempts):
            body = {"text": send_text, "model_id": model, "voice_settings": voice_settings}
            try:
                async with s.post(url, headers=headers, json=body) as resp:
                    if resp.status != 200:
                        detail = (await resp.text())[:200]
                        last_err = f"{model} HTTP {resp.status}: {detail}"
                        # tag/model issues -> try the fallback model next
                        if i < len(attempts) - 1 and resp.status in (400, 403, 422):
                            continue
                        raise RuntimeError(last_err)
                    audio = await resp.read()
            except aiohttp.ClientError as e:
                last_err = str(e)
                if i < len(attempts) - 1:
                    continue
                raise RuntimeError(f"v3 TTS network error: {e}")
            duration_ms = max(400, int(len(audio) / config.ELEVEN_MP3_BYTES_PER_MS))
            words = _spread_words(emotion.strip_tags(text), duration_ms)
            return audio, words, duration_ms
    raise RuntimeError(last_err or "v3 TTS failed")


# ---------------------------------------------------------------------------
# flash — low-latency WebSocket with exact alignment (no emotion)
# ---------------------------------------------------------------------------
async def _synthesize_flash(text, *, voice_id, api_key, output_format):
    spoken = emotion.strip_tags(text)  # flash can't read v3 tags
    uri = (
        f"{config.ELEVEN_BASE_URL}/v1/text-to-speech/{voice_id}/stream-input"
        f"?model_id={config.ELEVEN_FLASH_MODEL}&output_format={output_format}"
    )
    audio = bytearray()
    chars: list[str] = []
    starts: list[int] = []
    time_offset, last_seen = 0, -1
    async with websockets.connect(uri, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({
            "text": " ",
            "voice_settings": {"stability": 0.4, "similarity_boost": 0.85, "use_speaker_boost": True},
            "generation_config": {"chunk_length_schedule": config.ELEVEN_CHUNK_SCHEDULE},
            "xi_api_key": api_key,
        }))
        await ws.send(json.dumps({"text": spoken + " ", "flush": True}))
        await ws.send(json.dumps({"text": ""}))
        while True:
            try:
                message = await ws.recv()
            except websockets.exceptions.ConnectionClosed:
                break
            data = json.loads(message)
            if data.get("audio"):
                audio.extend(base64.b64decode(data["audio"]))
            align = data.get("normalizedAlignment") or data.get("alignment")
            if align and align.get("chars"):
                a_chars = align.get("chars") or []
                a_starts = align.get("charStartTimesMs") or []
                a_durs = align.get("charDurationsMs") or align.get("charsDurationsMs") or []
                if a_starts and a_starts[0] <= last_seen:
                    time_offset = (starts[-1] + 1) if starts else time_offset
                for i, ch in enumerate(a_chars):
                    s = (a_starts[i] if i < len(a_starts) else 0) + time_offset
                    chars.append(ch)
                    starts.append(s)
                    last_seen = a_starts[i] if i < len(a_starts) else last_seen
                if a_starts and a_durs:
                    time_offset = starts[-1] + (a_durs[-1] if a_durs else 0)
                    last_seen = -1
            if data.get("isFinal"):
                break
    if chars and starts:
        return bytes(audio), _words_from_alignment(chars, starts), max(starts[-1] + 250, 400)
    dur = max(400, int(len(audio) / config.ELEVEN_MP3_BYTES_PER_MS)) if audio else \
        max(400, int(len(spoken.split()) / 3.3 * 1000))
    return bytes(audio), _spread_words(spoken, dur), dur


# ---------------------------------------------------------------------------
# dispatcher
# ---------------------------------------------------------------------------
async def synthesize(text, *, voice_settings=None, engine=None, voice_id=None, api_key=None, output_format=None):
    """Speak `text` (optionally v3-tagged) and return (audio, words, duration_ms).
    Picks the engine from config unless overridden. Raises if no key."""
    api_key = api_key or config.ELEVEN_API_KEY
    voice_id = voice_id or config.ELEVEN_VOICE_ID
    output_format = output_format or config.ELEVEN_OUTPUT_FORMAT
    engine = (engine or config.TTS_ENGINE).lower()
    if not api_key:
        raise RuntimeError("No ELEVENLABS_API_KEY configured.")
    if engine == "flash":
        return await _synthesize_flash(text, voice_id=voice_id, api_key=api_key, output_format=output_format)
    settings = voice_settings or config.ELEVEN_VOICE_SETTINGS
    try:
        return await _synthesize_v3(text, voice_settings=settings, voice_id=voice_id, api_key=api_key, output_format=output_format)
    except Exception:
        # v3 is the priciest model and the first to hit a quota wall. Fall back to
        # the cheap flash model so the match keeps its voice instead of going silent.
        return await _synthesize_flash(text, voice_id=voice_id, api_key=api_key, output_format=output_format)
