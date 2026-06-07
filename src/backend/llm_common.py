from __future__ import annotations

import logging
import os
import sqlite3

logger = logging.getLogger(__name__)


class LLMCallError(Exception):
    """Raised when an LLM API call fails; carries the HTTP status code and elapsed time."""

    def __init__(self, message: str, http_code: int, time_taken: float) -> None:
        super().__init__(message)
        self.http_code = http_code
        self.time_taken = time_taken


def calculate_cost(tokens: int, rate_per_million: float) -> float:
    return (tokens / 1_000_000) * rate_per_million


def _read_key_from_db(provider: str) -> str | None:
    try:
        from backend.crypto_service import decrypt_secret
        from backend.use_cases.llm_routing import (
            ROUTING_GROQ,
            ROUTING_OPENROUTER,
            _primary_key_row_for_lane,
        )

        lane = ROUTING_GROQ if provider == "groq" else ROUTING_OPENROUTER
        row = _primary_key_row_for_lane(lane)
        if row:
            return decrypt_secret(str(row["key_value"]))
    except sqlite3.Error as exc:
        logger.warning("DB error reading API key for %s: %s", provider, exc)
    return None


def get_provider_api_key(provider: str) -> str:
    """Resolve API key for openrouter, groq, or ollama."""
    if provider == "ollama":
        return "ollama"

    if provider == "groq":
        key = os.environ.get("GROQ_API_KEY", "").strip() or (_read_key_from_db("groq") or "")
        if not key:
            raise RuntimeError("No Groq API key configured.")
        return key

    key = _read_key_from_db("openrouter") or os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        raise RuntimeError("No active API key configured. Please add an API key in Settings.")
    return key


def get_active_api_key() -> str:
    """OpenRouter-compatible active key (legacy name)."""
    return get_provider_api_key("openrouter")
