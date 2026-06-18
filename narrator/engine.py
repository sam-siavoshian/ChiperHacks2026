"""The always-talking commentary engine.

Consumes the live arena event feed and drives a continuous play-by-play voice,
just like a real match broadcast. Two cooperating tasks:

  producer — keeps the next spoken line generated and ready (LLM -> TTS), running
             exactly one line ahead so generation latency hides under playback.
  player   — emits each ready line to the TV as a `commentary` event and waits the
             clip's duration before the next, so audio never overlaps.

Because the producer builds the next line from the *freshest* event context while
the current line is still playing, goals and saves get called within ~one line.

Modes (chosen by which keys are present):
  - LLM + TTS:  full continuous play-by-play with voice (the real deal).
  - LLM only:   continuous captions, no audio.
  - TTS only:   voices the arena's own commentary lines verbatim (no filler).
  - neither:    the engine is inert; the server just relays events untouched.
"""

import asyncio
import time
from collections import OrderedDict, deque

from . import config, emotion, llm, tts

# spoken-line emotion -> the caption accent bucket the TV already understands
_EMO_ENUM = {"goal": "hype", "save": "hype", "buildup": "normal",
             "tense": "normal", "setback": "calm", "neutral": "normal"}


def _payload(env):
    return env.get("payload") or {}


def describe(env):
    """Map an arena event to (text, intensity, trigger, is_big) for the LLM
    context, or (None, ...) to ignore. `is_big` marks goals/saves/whistles."""
    t = env.get("type")
    p = _payload(env)
    if t == "round_start":
        return (f"KICKOFF, round {p.get('round')}: {p.get('title') or 'the match is live'}.", "hype", "kickoff", True)
    if t == "round_end":
        return (f"FULL TIME: {p.get('summary') or 'match over'}. Winner: {p.get('winner')}.", "hype", "fulltime", True)
    if t == "exploit_success":
        return (f"RED SCORES — broke {p.get('class')} at {p.get('url')}. {p.get('evidence') or ''}".strip() + ".", "hype", "goal", True)
    if t == "blue.mitigate":
        return (f"BLUE SAVES — patched {p.get('label') or p.get('assetId')}.", "hype", "save", True)
    if t == "blue.blocked":
        return (f"BLUE's rule blocks RED at {p.get('url')} (HTTP {p.get('status')}).", "normal", "block", False)
    if t == "vuln_found":
        return (f"RED sniffs out a {p.get('severity')} {p.get('class')} weakness at {p.get('url')}.", "normal", "vuln", False)
    if t == "blue.detect":
        return (f"BLUE detects pressure on {p.get('threat')}.", "normal", "detect", False)
    if t == "agent.thinking":
        # The agent's own mind, lifted off its live session stream by the runner tap.
        # This is what it is REASONING — the plan, the read of the game. Low energy,
        # never a "goal"; it gives the caster something real to explain in the lulls.
        ag = p.get("agent") or env.get("agent") or ""
        side = "BLUE" if ag == "blue" else "RED"
        text = str(p.get("text") or "").strip()
        if not text:
            return (None, "normal", "beat", False)
        return (f"{side} is thinking: {text}", "calm", "mind", False)
    if t == "attempting":
        # Both MCPs self-report an intent line BEFORE each tool call and a result line
        # AFTER (attacker/tools.py + defender/tools.py auto_report); the runner tap also
        # reports BLUE's native file surgery here. `note` is the one-liner; `detail`
        # carries the REAL substance — the payload sent, what leaked, what changed — so
        # the caster quotes the actual hack. `phase` drives the intent->payoff two-beat.
        ag = p.get("agent") or env.get("agent") or ""
        side = "BLUE" if ag == "blue" else "RED"
        note = p.get("note") or p.get("target") or "working the target"
        area = p.get("area") or "recon"
        tool = p.get("tool") or "probe"
        phase = p.get("phase")
        d = p.get("detail") or {}
        extra = ""
        if d.get("payload"):
            extra += f" [payload: {d['payload']}]"
        if d.get("changedField"):
            extra += f" [changed: {d['changedField']}]"
        if d.get("bodySnippet"):
            extra += f" [response: {d['bodySnippet']}]"
        if d.get("file"):
            extra += f" [file: {d['file']}]"
        if d.get("status") is not None:
            extra += f" [HTTP {d['status']}]"
        lead = f"{side} is lining up" if phase == "intent" else f"{side}"
        # outcome lines / detail that signal a hit deserve a little more energy
        signal = (note + " " + extra).lower()
        hit = any(k in signal for k in ("injectable", "fired", "goal", "blocked", "idor",
                                        "executed", "captured", "mass-assignment", "patched",
                                        "mitigated", "leaked", "dumped", "session '"))
        return (f"{lead} [{area}] {note}.{extra}", "normal" if hit else "calm", tool, False)
    if t == "handoff":
        return (f"RED switches it up: {p.get('from')} to {p.get('to')}.", "calm", "handoff", False)
    if t == "exfil.chunk":
        return (f"RED is pulling data — {p.get('filename')} ({p.get('bytes')} bytes).", "normal", "exfil", False)
    if t == "error":
        return (f"RED's {p.get('tool')} misfires.", "calm", "error", False)
    if t == "commentary":
        # The arena's own ground-truth call. Feed it verbatim as authoritative.
        return (str(p.get("text") or ""), p.get("intensity") or "normal", p.get("trigger") or "beat", (p.get("intensity") == "hype"))
    return (None, "normal", "beat", False)


_ORDER = {"calm": 0, "normal": 1, "hype": 2}


class CommentaryEngine:
    def __init__(self, *, forward, tts_fn=None, llm_fn=None):
        # forward(envelope) -> awaitable: ships a finished commentary event to the TV.
        self._forward = forward
        self._tts = tts_fn or tts.synthesize
        self._llm = llm_fn or llm.next_line

        self.clips: "OrderedDict[str, bytes]" = OrderedDict()
        self._ready: asyncio.Queue = asyncio.Queue(maxsize=1)
        self._voice_jobs: asyncio.Queue = asyncio.Queue()  # fallback (TTS-only) mode

        # rolling match context
        self.live = False
        self.round = 0
        self.red = 0
        self.blue = 0
        self.health = 100
        self.meta = ""  # e.g. "RED claude-opus-4-8 vs BLUE gpt-5"
        self._pending: list[tuple[str, str, str, bool]] = []
        self._recent: deque = deque(maxlen=6)
        self._lines_this_match = 0
        self._counter = 0
        self._tasks: list[asyncio.Task] = []
        self._running = False
        self._last_event = time.monotonic()
        self._red_owns: list[str] = []   # areas RED has scored in (match memory)
        self._blue_saves: list[str] = []  # areas BLUE has held

    # -- mode flags ---------------------------------------------------------
    @property
    def active(self) -> bool:
        return config.llm_enabled() or config.tts_enabled()

    @property
    def owns_commentary(self) -> bool:
        """True when the engine produces the commentary channel itself, so the
        server should suppress the arena's raw commentary events."""
        return self.active

    # -- ingest -------------------------------------------------------------
    # Events that mean "the match is happening" — any of these wakes the voice,
    # so the narrator talks no matter which producer is wired (orchestrator,
    # attacker MCP, or both). round_end is the only thing that puts it to sleep.
    _ACTIVITY = {
        "attempting", "agent.thinking", "vuln_found", "exploit_success", "blue.detect",
        "blue.mitigate", "blue.blocked", "asset.discovered", "handoff",
        "exfil.chunk", "score.update", "commentary", "timer",
    }

    def ingest(self, env: dict) -> None:
        """Fold one arena event into the live context. Never blocks."""
        t = env.get("type")
        p = _payload(env)
        self._last_event = time.monotonic()
        if t == "round_start":
            self.live = True
            self.round = int(p.get("round") or self.round or 1)
            self.red = int(p.get("redScore") or 0)
            self.blue = int(p.get("blueScore") or 0)
            self.health = 100
            self._lines_this_match = 0
            self._red_owns.clear(); self._blue_saves.clear()
        elif t == "score.update":
            self.red = int(p.get("red", self.red))
            self.blue = int(p.get("blue", self.blue))
            self.health = int(p.get("health", self.health))
            self.live = True
        elif t == "round_end":
            # let the whistle line play, then go quiet
            self.live = True  # stays true so the fulltime line generates; producer caps lines
        elif t in self._ACTIVITY:
            self.live = True
        # match memory: who has broken what, who has held
        if t == "exploit_success":
            area = str(p.get("class") or p.get("url") or "").strip()
            if area and area not in self._red_owns:
                self._red_owns.append(area)
        elif t == "blue.mitigate":
            area = str(p.get("label") or p.get("threat") or p.get("assetId") or "").strip()
            if area and area not in self._blue_saves:
                self._blue_saves.append(area)

        desc, intensity, trigger, is_big = describe(env)
        if desc:
            self._pending.append((desc, intensity, trigger, is_big))
            # keep pending bounded; if RED/BLUE flood, keep the big ones + tail
            if len(self._pending) > 24:
                bigs = [x for x in self._pending if x[3]]
                self._pending = (bigs + self._pending[-12:])[-24:]

        # TTS-only fallback: voice the arena's own commentary verbatim.
        if t == "commentary" and not config.llm_enabled() and config.tts_enabled():
            text = str(p.get("text") or "").strip()
            if text:
                self._voice_jobs.put_nowait((text, p.get("intensity") or "normal", p.get("trigger") or "beat"))

        if t == "round_end":
            self.live = False

    def set_meta(self, meta: str) -> None:
        self.meta = meta or self.meta

    # -- clip building ------------------------------------------------------
    def _next_id(self) -> str:
        self._counter += 1
        return f"nar_{self._counter:05d}"

    def _store_clip(self, cid: str, audio: bytes) -> None:
        if not audio:
            return
        self.clips[cid] = audio
        while len(self.clips) > config.CLIP_CACHE_MAX:
            self.clips.popitem(last=False)

    async def _make_clip(self, text: str, trigger: str, llm_emotion: str | None = None) -> dict | None:
        cid = self._next_id()
        # Classify the spoken line: emotion drives the v3 delivery tag + voice
        # settings, intensity (0..1) drives the crowd bed. LLM-supplied emotion
        # wins; otherwise it's detected from the words (the partner's hybrid).
        plan = emotion.analyze(text, emotion=llm_emotion)
        words = None
        duration_ms = max(1200, int(len(text.split()) / 3.3 * 1000))
        audio_url = None
        if config.tts_enabled():
            try:
                audio, words, duration_ms = await self._tts(plan["tagged_text"], voice_settings=plan["voice_settings"])
                self._store_clip(cid, audio)
                if audio:
                    audio_url = f"{config.PUBLIC_URL}/audio/{cid}.mp3"
            except Exception:
                # voice hiccup: still show the caption, no audio
                words, audio_url = None, None
        return {
            "id": cid, "text": text, "trigger": trigger,
            "intensity": _EMO_ENUM.get(plan["emotion"], "normal"),  # caption accent bucket
            "emotion": plan["emotion"], "crowd": plan["intensity"],  # crowd bed drivers
            "words": words, "durationMs": int(duration_ms), "audioUrl": audio_url,
        }

    def _state_summary(self) -> str:
        meta = f" {self.meta}." if self.meta else ""
        owns = f" RED has already broken: {', '.join(self._red_owns[-6:])}." if self._red_owns else ""
        saves = f" BLUE has held: {', '.join(self._blue_saves[-6:])}." if self._blue_saves else ""
        return (f"Round {self.round}. Score: RED {self.red} - BLUE {self.blue}. "
                f"Target integrity {self.health}%.{owns}{saves}{meta}")

    def _drain_pending(self) -> tuple[str, str, str]:
        """Consume new action since the last line; return (joined_text, intensity, trigger)."""
        items, self._pending = self._pending, []
        if not items:
            return "", "normal", "beat"
        text = " ".join(d for d, _, _, _ in items)
        intensity = max((i for _, i, _, _ in items), key=lambda x: _ORDER.get(x, 1))
        # prefer the trigger of the most intense / last big event
        trig = "beat"
        for _, i, tr, big in items:
            if big:
                trig = tr
        return text, intensity, trig

    # -- the two loops ------------------------------------------------------
    async def _producer_llm(self):
        while self._running:
            if not self.live or self._lines_this_match >= config.MAX_LINES_PER_MATCH:
                await asyncio.sleep(0.25)
                continue
            # Keep talking through short lulls (filler/anticipation), but after a
            # long silence with nothing pending, go quiet instead of rambling.
            if not self._pending and (time.monotonic() - self._last_event) > config.IDLE_QUIET_S:
                await asyncio.sleep(0.5)
                continue
            action, _hint, trigger = self._drain_pending()
            res = await self._llm(
                state_summary=self._state_summary(),
                new_action=action,
                recent_lines=list(self._recent),
            )
            if not res:
                await asyncio.sleep(0.6)
                continue
            line, llm_emotion = res
            self._recent.append(line)
            clip = await self._make_clip(line, trigger, llm_emotion)
            self._lines_this_match += 1
            if clip:
                await self._ready.put(clip)  # blocks until player takes the previous (1 ahead)

    async def _producer_fallback(self):
        while self._running:
            text, _intensity, trigger = await self._voice_jobs.get()
            clip = await self._make_clip(text, trigger, None)
            if clip:
                await self._ready.put(clip)

    async def _player(self):
        while self._running:
            clip = await self._ready.get()
            await self._emit(clip)
            await asyncio.sleep((clip["durationMs"] + config.LINE_GAP_MS) / 1000.0)

    async def _emit(self, clip: dict):
        payload = {
            "text": clip["text"],
            "intensity": clip["intensity"],         # calm|normal|hype (caption accent)
            "emotion": clip.get("emotion", "neutral"),  # goal|save|setback|buildup|tense|neutral
            "crowd": clip.get("crowd", 0.3),         # 0..1, drives the crowd bed
            "trigger": clip["trigger"],
            "caster": config.NARRATOR_NAME,
            "audioUrl": clip["audioUrl"],
            "durationMs": clip["durationMs"],
        }
        if clip.get("words"):
            payload["words"] = clip["words"]
        env = {
            "id": clip["id"],
            "ts": int(time.time() * 1000),
            "round": self.round,
            "agent": "caster",
            "type": "commentary",
            "target": None,
            "payload": payload,
        }
        try:
            await self._forward(env)
        except Exception:
            pass

    # -- lifecycle ----------------------------------------------------------
    def start(self):
        if self._running or not self.active:
            return
        self._running = True
        producer = self._producer_llm if config.llm_enabled() else self._producer_fallback
        self._tasks = [asyncio.create_task(producer()), asyncio.create_task(self._player())]

    async def stop(self):
        self._running = False
        for tk in self._tasks:
            tk.cancel()
        for tk in self._tasks:
            try:
                await tk
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks = []
