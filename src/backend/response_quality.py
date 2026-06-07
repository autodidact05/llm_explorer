"""Instructions so assistant replies stay readable and use consistent English."""

from __future__ import annotations

_RESPONSE_QUALITY_NOTE = (
    "Response language and formatting (mandatory):\n"
    "- Write the entire reply in English only — every sentence, heading, bullet, and table cell.\n"
    "- Do not use Hindi, Bengali, Arabic, Chinese, Japanese, Cyrillic, or any other script.\n"
    "- All proper nouns (people, places, schools, companies, institutes) must use standard "
    "English/Latin spelling only (e.g. Ahmedabad, Gandhinagar, Bengaluru, National Institute of Design).\n"
    "- Never mix scripts inside a name or word (no invented or garbled characters).\n"
    "- If the user writes in another language, still reply in English unless they explicitly "
    "ask for that language.\n"
    "- Use consecutive numbering in ordered lists: 1, 2, 3, … within each list. "
    "Start each new list at 1. Do not skip numbers (e.g. do not jump from 3 to 10).\n"
    "- If you are unsure of a fact or spelling, say so; do not guess or fabricate names."
)


def append_response_quality(message: str | None) -> str:
    if message and message.strip():
        return f"{message.strip()}\n\n{_RESPONSE_QUALITY_NOTE}"
    return _RESPONSE_QUALITY_NOTE
