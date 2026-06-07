from __future__ import annotations

from typing import Any

# Rough char budget (~4 chars/token) for answering LLM history before the latest user turn.
DEFAULT_MAX_HISTORY_CHARS = 80_000
MAX_HISTORY_MESSAGES = 80


def trim_message_history(
    history: list[dict[str, Any]],
    *,
    max_messages: int = MAX_HISTORY_MESSAGES,
    max_chars: int = DEFAULT_MAX_HISTORY_CHARS,
) -> list[dict[str, Any]]:
    """Keep the most recent messages within message and character budgets."""
    if not history:
        return history

    candidate = history[-max_messages:] if len(history) > max_messages else list(history)
    total = 0
    kept: list[dict[str, Any]] = []
    for row in reversed(candidate):
        total += len(str(row.get("content") or ""))
        kept.append(row)
        if total > max_chars:
            break
    kept.reverse()
    if len(kept) < len(history) and kept:
        kept.insert(
            0,
            {"role": "user", "content": "[Earlier conversation truncated for context limit.]"},
        )
    return kept
