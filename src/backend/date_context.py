from __future__ import annotations

from datetime import UTC, datetime


def build_date_context() -> str:
    """Return a short date line models should treat as authoritative."""
    today = datetime.now(UTC)
    iso_date = today.strftime("%Y-%m-%d")
    formatted = today.strftime("%A, %B %d, %Y")
    return (
        f"Today's date is {formatted} (UTC, {iso_date}). "
        "Treat this as the authoritative current date when answering questions about "
        "today, tomorrow, this week, weekends, or other relative dates."
    )


def append_date_context(message: str | None) -> str:
    """Append the current date to a system message (or return date-only text)."""
    date_line = build_date_context()
    if message and message.strip():
        return f"{message.strip()}\n\n{date_line}"
    return date_line
