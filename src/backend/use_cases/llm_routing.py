"""OpenRouter vs Groq routing: settings, env keys, and per-lane active DB keys."""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import HTTPException

from backend.config import GROQ_SUPPORTED_MODELS, openrouter_provider_sql_clause
from backend.crypto_service import decrypt_secret
from backend.db import db_connection
from backend.repos.settings_keys import SettingsKey
from backend.repos.settings_repo import get_settings, upsert_settings
from backend.use_cases.groq_models import ensure_groq_catalog, sync_groq_models

ROUTING_GROQ = "groq"
ROUTING_OPENROUTER = "openrouter"

logger = logging.getLogger(__name__)

OPENROUTER_LANE_PROVIDERS: frozenset[str] = frozenset({
    "openrouter",
    "openai",
    "anthropic",
    "other",
})


def routing_lane_for_stored_provider(provider: str) -> str:
    if (provider or "").strip().lower() == "groq":
        return ROUTING_GROQ
    return ROUTING_OPENROUTER


def catalog_sql_clause() -> tuple[str, list[Any]]:
    """SQL fragment + params limiting model_pricing to the active routing catalogue."""
    routing = get_active_llm_routing()
    if routing == ROUTING_GROQ:
        ensure_groq_catalog()
        models = sorted(GROQ_SUPPORTED_MODELS)
        placeholders = ", ".join("?" * len(models))
        return (
            f"router = 'groq' AND provider = 'groq' AND model IN ({placeholders})",
            models,
        )
    if routing == ROUTING_OPENROUTER:
        or_clause, or_params = openrouter_provider_sql_clause()
        return f"({or_clause}) AND provider != 'groq'", or_params
    return openrouter_provider_sql_clause()


def get_active_llm_routing() -> str | None:
    """Which provider lane is selected for chat (openrouter or groq)."""
    raw = get_settings([SettingsKey.ACTIVE_LLM_ROUTING]).get(SettingsKey.ACTIVE_LLM_ROUTING)
    if raw in (ROUTING_OPENROUTER, ROUTING_GROQ):
        return raw
    row = _primary_key_row_for_lane(ROUTING_OPENROUTER) or _primary_key_row_for_lane(ROUTING_GROQ)
    if row:
        return routing_lane_for_stored_provider(str(row["provider"]))
    if os.environ.get("OPENROUTER_API_KEY", "").strip():
        return ROUTING_OPENROUTER
    if os.environ.get("GROQ_API_KEY", "").strip():
        return ROUTING_GROQ
    return None


def set_active_llm_routing(routing: str) -> None:
    if routing not in (ROUTING_OPENROUTER, ROUTING_GROQ):
        raise HTTPException(400, "routing must be 'openrouter' or 'groq'")
    if not lane_is_configured(routing):
        raise HTTPException(
            400,
            f"No {routing} API key configured. Add a key in Settings → API Keys first.",
        )
    upsert_settings({SettingsKey.ACTIVE_LLM_ROUTING: routing})
    if routing == ROUTING_GROQ:
        ensure_groq_catalog()


def lane_is_configured(lane: str) -> bool:
    if _primary_key_row_for_lane(lane):
        return True
    if lane == ROUTING_GROQ:
        return bool(os.environ.get("GROQ_API_KEY", "").strip())
    return bool(os.environ.get("OPENROUTER_API_KEY", "").strip())


def _lane_sql(lane: str) -> tuple[str, list[str]]:
    if lane == ROUTING_GROQ:
        return "provider = ?", ["groq"]
    placeholders = ", ".join("?" * len(OPENROUTER_LANE_PROVIDERS))
    return f"provider IN ({placeholders})", list(OPENROUTER_LANE_PROVIDERS)


def _primary_key_row_for_lane(lane: str) -> dict[str, Any] | None:
    clause, params = _lane_sql(lane)
    with db_connection() as conn:
        row = conn.execute(
            f"""
            SELECT id, name, provider, key_value, key_preview, is_active
            FROM api_keys
            WHERE {clause}
            ORDER BY is_active DESC, id DESC
            LIMIT 1
            """,
            params,
        ).fetchone()
    return dict(row) if row else None


def refresh_llm_env_from_db() -> None:
    """Load both lane keys into process env (latest / active per lane)."""
    groq_row = _primary_key_row_for_lane(ROUTING_GROQ)
    if groq_row:
        try:
            os.environ["GROQ_API_KEY"] = decrypt_secret(str(groq_row["key_value"]))
        except Exception as exc:
            logger.warning("Could not decrypt Groq key: %s", exc)

    or_row = _primary_key_row_for_lane(ROUTING_OPENROUTER)
    if or_row:
        try:
            os.environ["OPENROUTER_API_KEY"] = decrypt_secret(str(or_row["key_value"]))
        except Exception as exc:
            logger.warning("Could not decrypt OpenRouter-lane key: %s", exc)


def apply_active_llm_routing() -> None:
    """Persist routing choice and refresh HTTP clients."""
    from backend.use_cases.agent_client import reset_agent_clients

    refresh_llm_env_from_db()
    if get_active_llm_routing() == ROUTING_GROQ:
        ensure_groq_catalog()
    reset_agent_clients()


def get_routing_status() -> dict[str, Any]:
    """UI state: active lane and whether each lane has a key."""
    active = get_active_llm_routing()
    or_row = _primary_key_row_for_lane(ROUTING_OPENROUTER)
    groq_row = _primary_key_row_for_lane(ROUTING_GROQ)
    or_env = bool(os.environ.get("OPENROUTER_API_KEY", "").strip())
    groq_env = bool(os.environ.get("GROQ_API_KEY", "").strip())

    return {
        "active_routing": active,
        "openrouter": {
            "configured": or_row is not None or or_env,
            "enabled": active == ROUTING_OPENROUTER,
            "key_preview": (or_row["key_preview"] if or_row else None)
            or ("(env)" if or_env and not or_row else None),
            "key_name": (or_row["name"] if or_row else None)
            or ("Environment" if or_env and not or_row else None),
        },
        "groq": {
            "configured": groq_row is not None or groq_env,
            "enabled": active == ROUTING_GROQ,
            "key_preview": (groq_row["key_preview"] if groq_row else None)
            or ("(env)" if groq_env and not groq_row else None),
            "key_name": (groq_row["name"] if groq_row else None)
            or ("Environment" if groq_env and not groq_row else None),
        },
    }


def activate_key_for_lane(*, key_id: int, stored_provider: str, key_value: str) -> str:
    """Mark key active within its lane, set routing to that lane, refresh env."""
    lane = routing_lane_for_stored_provider(stored_provider)
    clause, params = _lane_sql(lane)
    with db_connection() as conn:
        conn.execute(f"UPDATE api_keys SET is_active = 0 WHERE {clause}", params)
        conn.execute("UPDATE api_keys SET is_active = 1 WHERE id = ?", [key_id])

    set_active_llm_routing(lane)

    if lane == ROUTING_GROQ:
        os.environ["GROQ_API_KEY"] = key_value
        try:
            sync_groq_models()
        except Exception as exc:
            logger.warning("Groq catalogue sync on activation failed: %s", exc)
    else:
        os.environ["OPENROUTER_API_KEY"] = key_value

    refresh_llm_env_from_db()
    return lane
