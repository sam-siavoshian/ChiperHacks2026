"""Emotion + crowd intensity classifier for a line of commentary.

Ported from the partner's cyberpitch_narration.py `analyze()`. Pure, no API call,
instant. Returns the emotion, an intensity (0..1) that drives the crowd bed, the
ElevenLabs v3 tag to lead the delivery with, and the per-emotion voice settings.

HYBRID source (per the partner's note): if the narrator LLM already emits an
emotion label, pass it as `emotion=` and it wins; otherwise the emotion is
detected from keywords + punctuation in the text. Plain text still works.
"""

import re

# emotion -> (v3 lead tag, baseline crowd intensity, voice settings).
# Lower stability + higher style = more dynamic; speed <1 drags a dejected line,
# >1 pushes excitement.
EMOTIONS: dict[str, dict] = {
    "goal":    {"tag": "[shouting]", "intensity": 1.00,
                "settings": {"stability": 0.30, "similarity_boost": 0.80, "style": 0.70, "use_speaker_boost": True, "speed": 1.05}},
    "buildup": {"tag": "[excited]",  "intensity": 0.72,
                "settings": {"stability": 0.35, "similarity_boost": 0.80, "style": 0.60, "use_speaker_boost": True, "speed": 1.05}},
    "save":    {"tag": "[excited]",  "intensity": 0.75,
                "settings": {"stability": 0.35, "similarity_boost": 0.80, "style": 0.55, "use_speaker_boost": True, "speed": 1.00}},
    "tense":   {"tag": "[nervous]",  "intensity": 0.50,
                "settings": {"stability": 0.45, "similarity_boost": 0.80, "style": 0.40, "use_speaker_boost": True, "speed": 0.98}},
    "setback": {"tag": "[sad]",      "intensity": 0.26,
                "settings": {"stability": 0.55, "similarity_boost": 0.80, "style": 0.30, "use_speaker_boost": True, "speed": 0.92}},
    "neutral": {"tag": "",           "intensity": 0.32,
                "settings": {"stability": 0.45, "similarity_boost": 0.80, "style": 0.40, "use_speaker_boost": True, "speed": 1.00}},
}

GOAL_VERBS = ["scores", "scored", "nets it", "finds the net", "buries it", "back of the net",
              "in the net", "took the lead", "slots it home", "smashes it in",
              "exploited", "exploit lands", "breach", "breached", "cracks", "cracked",
              "pwned", "owned", "popped the", "critical vulnerability"]
BUILDUP_WORDS = ["almost", "nearly", "so close", "on goal", "through on goal", "one on one",
                 "in the box", "bearing down", "breaks through", "driving forward", "about to",
                 "incoming", "building", "probing", "scanning", "approaching", "danger",
                 "threat", "surges", "makes a run", "counterattack", "counter attack"]
SAVE_WORDS = ["save", "saved", "blocked", "patched", "mitigated", "defended", "denied",
              "intercepted", "intercepts", "cleared", "parried", "shut down", "shuts it down",
              "kept out", "held firm", "stops it", "stopped", "wall holds"]
SETBACK_WORDS = ["miss", "missed", "fails", "failed", "blunder", "wasted", "wide", "off target",
                 "no good", "turned away", "gives away", "conceded", "own goal", "error",
                 "ruled out", "slips", "fumbles", "offside"]
TENSE_WORDS = ["tense", "pressure", "nervy", "hanging in the balance", "cagey", "stalemate",
               "deadlock", "holding their breath"]


def _has(text_lower: str, kw: str) -> bool:
    if " " in kw:
        return kw in text_lower
    return re.search(rf"\b{re.escape(kw)}\b", text_lower) is not None


def detect_state(text: str) -> str:
    """An emphatic scored goal wins; then a build-up/chance; then save / setback /
    tense; a plain 'goal' mention falls through to goal; else neutral."""
    t = text.lower()
    emphatic_goal = (re.search(r"go{2,}a+l", t) or re.search(r"goal\s*!", t)
                     or any(_has(t, k) for k in GOAL_VERBS))
    if emphatic_goal:
        return "goal"
    if any(_has(t, k) for k in BUILDUP_WORDS):
        return "buildup"
    if any(_has(t, k) for k in SAVE_WORDS):
        return "save"
    if any(_has(t, k) for k in SETBACK_WORDS):
        return "setback"
    if any(_has(t, k) for k in TENSE_WORDS):
        return "tense"
    if _has(t, "goal"):
        return "goal"
    return "neutral"


def analyze(text: str, emotion: str | None = None) -> dict:
    """Classify a commentary line. `emotion` (if a known label) overrides detection.
    Returns {emotion, intensity, tag, tagged_text, voice_settings}."""
    state = (emotion or "").strip().lower() or None
    if state not in EMOTIONS:
        state = detect_state(text)
    spec = EMOTIONS[state]

    intensity = spec["intensity"]
    intensity += min(text.count("!") * 0.05, 0.20)        # excitement punctuation
    if re.search(r"[A-Z]{3,}", text):
        intensity += 0.10                                  # SHOUTED words
    if re.search(r"(.)\1\1", text):
        intensity += 0.08                                  # elongation e.g. GOOOAL
    intensity = round(max(0.0, min(1.0, intensity)), 2)

    tag = spec["tag"]
    tagged_text = f"{tag} {text}".strip() if tag else text
    return {
        "emotion": state,
        "intensity": intensity,
        "tag": tag,
        "tagged_text": tagged_text,
        "voice_settings": spec["settings"],
    }


def strip_tags(s: str) -> str:
    """Remove leading [tag] markers (for the fallback model that can't read them)."""
    return re.sub(r"\[[^\]]+\]\s*", "", s)
