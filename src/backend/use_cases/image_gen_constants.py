"""Image-generation defaults and intent detection.

Regex tuning: adjust _IMAGE_INTENT_RE when users report false positives/negatives.
Prefer adding narrow alternation branches over broad ``.*`` patterns.
"""

from __future__ import annotations

import re

IMAGE_GEN_PROVIDER = "google"
IMAGE_GEN_MODEL = "gemini-2.5-flash-image"

_IMAGE_NOUNS = (
    r"(?:image|picture|photo|photograph|illustration|artwork|painting|"
    r"wallpaper|logo|banner|graphic|visual|portrait|landscape|drawing|sketch)"
)

_ART = r"(?:a|an|the|my|your|me|us|one|some|this|that)\s+"

_IMAGE_INTENT_RE = re.compile(
    r"(?:"
    + r"\b(?:draw|paint|sketch|illustrate|render)\b\s+" + _ART + r"\w"
    + r"|\b(?:generate|create|make|produce|design)\b[^.!?\n]{0,80}?" + _IMAGE_NOUNS
    + r"|\b(?:show|give)\s+me\b[^.!?\n]{0,50}?" + _IMAGE_NOUNS
    + r")",
    re.IGNORECASE,
)


def detect_image_generation_intent(content: str) -> bool:
    return bool(_IMAGE_INTENT_RE.search(content))
