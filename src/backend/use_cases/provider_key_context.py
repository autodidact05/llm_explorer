"""Active API key capabilities: routing mode, usable models, remote balance hints."""

from __future__ import annotations

import logging
import os
from typing import Any

from backend.config import GROQ_SUPPORTED_MODELS
from backend.use_cases.llm_routing import catalog_sql_clause
from backend.crypto_service import decrypt_secret
from backend.db import db_connection
from backend.use_cases.openrouter_credits import fetch_openrouter_credits, fetch_openrouter_key_info

logger = logging.getLogger(__name__)

# Stored ``api_keys.provider`` values → how the app routes LLM HTTP calls.
ROUTING_OPENROUTER = "openrouter"
ROUTING_GROQ = "groq"
ROUTING_MISCONFIGURED = "misconfigured"

# Diverse catalogue examples for UI copy (not alphabetical DB order).
_GROQ_MODEL_EXAMPLES: list[tuple[str, str]] = [
    ("groq", model_id) for model_id in sorted(GROQ_SUPPORTED_MODELS)
]

_CURATED_MODEL_EXAMPLES: list[tuple[str, str]] = [
    ("amazon", "nova-2-lite-v1"),
    ("openai", "gpt-4o-mini"),
    ("amazon", "nova-lite-v1"),
    ("google", "gemini-2.5-flash"),
    ("amazon", "nova-micro-v1"),
    ("anthropic", "claude-haiku-4"),
    ("amazon", "nova-premier-v1"),
    ("meta-llama", "llama-3.3-70b-instruct"),
]


def get_active_key_routing() -> str | None:
    """Return routing mode selected for chat (openrouter or groq)."""
    from backend.use_cases.llm_routing import get_active_llm_routing

    return get_active_llm_routing()


def _active_key_row() -> dict[str, Any] | None:
    """Primary key row for the currently selected routing lane."""
    from backend.use_cases.llm_routing import (
        ROUTING_GROQ as _GROQ,
        ROUTING_OPENROUTER as _OR,
        _primary_key_row_for_lane,
        get_active_llm_routing,
    )

    routing = get_active_llm_routing()
    if routing == _GROQ:
        return _primary_key_row_for_lane(_GROQ)
    if routing == _OR:
        return _primary_key_row_for_lane(_OR)
    return _primary_key_row_for_lane(_OR) or _primary_key_row_for_lane(_GROQ)


def _resolve_routing(stored_provider: str) -> str:
    p = (stored_provider or "openrouter").strip().lower()
    if p == "groq":
        return ROUTING_GROQ
    if p == "openrouter":
        return ROUTING_OPENROUTER
    return ROUTING_MISCONFIGURED


def _count_models(*, provider_filter: str | None = None) -> int:
    clause, params = catalog_sql_clause()
    extra = ""
    extra_params: list[Any] = []
    if provider_filter:
        extra = " AND provider = ?"
        extra_params.append(provider_filter)
    with db_connection() as conn:
        n = conn.execute(
            f"""
            SELECT COUNT(*) FROM model_pricing
            WHERE status = 'active' AND {clause}{extra}
            """,
            [*params, *extra_params],
        ).fetchone()[0]
    return int(n)


def _sample_models(*, provider_filter: str | None = None, limit: int = 8) -> list[dict[str, str]]:
    """Return a mixed provider/model sample for UI hints."""
    if provider_filter == "groq":
        curated = _GROQ_MODEL_EXAMPLES
    else:
        curated = _CURATED_MODEL_EXAMPLES
        if provider_filter:
            curated = [(p, m) for p, m in curated if p == provider_filter]
    if curated:
        return [
            {"provider": p, "model": m}
            for p, m in curated[:limit]
        ]
    clause, params = catalog_sql_clause()
    extra = " AND provider = ?"
    with db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT provider, model FROM model_pricing
            WHERE status = 'active' AND {clause}{extra}
            ORDER BY provider, model
            LIMIT ?
            """,
            [*params, provider_filter, limit],
        ).fetchall()
    return [{"provider": str(r["provider"]), "model": str(r["model"])} for r in rows]


def _openrouter_balance(api_key: str) -> dict[str, Any]:
    try:
        key_info = fetch_openrouter_key_info(api_key)
        credits = fetch_openrouter_credits(api_key)
        limit = key_info.get("limit")
        usage = float(key_info.get("usage", 0) or 0)
        remaining: float | None = None
        if limit is not None:
            remaining = float(limit) - usage
        total_credits = credits.get("total_credits")
        total_usage = credits.get("total_usage")
        return {
            "available": True,
            "source": "openrouter",
            "label": "OpenRouter account",
            "remaining_usd": remaining,
            "usage_usd": usage,
            "limit_usd": float(limit) if limit is not None else None,
            "total_credits_usd": float(total_credits) if total_credits is not None else None,
            "total_usage_usd": float(total_usage) if total_usage is not None else None,
            "message": None,
        }
    except Exception as exc:
        logger.warning("OpenRouter balance fetch failed: %s", exc)
        return {
            "available": False,
            "source": "openrouter",
            "label": "OpenRouter account",
            "message": f"Could not fetch OpenRouter balance: {exc}",
        }


def _guide_for(stored_provider: str, routing: str) -> dict[str, Any]:
    p = stored_provider.lower()
    if routing == ROUTING_GROQ:
        groq_list = ", ".join(f"groq/{m}" for m in sorted(GROQ_SUPPORTED_MODELS))
        return {
            "title": "Groq API key active",
            "summary": (
                "Calls go directly to Groq. Only these models are supported: "
                f"{groq_list}."
            ),
            "tips": [
                "The Groq catalogue is updated automatically when you activate a Groq key.",
                "Router LLM only picks from the four supported Groq models.",
                "Wallet tracks usage from this app; Groq billing is managed at console.groq.com.",
            ],
            "models_filter": "groq",
            "chat_model_hint": "Provider groq — pick one of the four supported models.",
        }
    if routing == ROUTING_OPENROUTER:
        return {
            "title": "OpenRouter API key active",
            "summary": (
                "Calls go through OpenRouter. You can use any synced model in the catalogue "
                "(OpenAI, Anthropic, Google, Meta, etc.) by provider and model name."
            ),
            "tips": [
                "Run Sync models (OpenRouter) in Settings to refresh pricing.",
                "Use Wallet to reconcile OpenRouter credits with local spend.",
                "Enable Router LLM in Settings to auto-pick a model per message.",
            ],
            "models_filter": None,
            "chat_model_hint": "Pick any provider/model from the synced catalogue.",
        }
    # openai / anthropic / other labels — key is wired to OPENROUTER env incorrectly
    vendor = p if p in ("openai", "anthropic") else "vendor"
    return {
        "title": f"{vendor.title()} key label — use OpenRouter instead",
        "summary": (
            "LLM Explorer routes chat through OpenRouter (or Groq for Groq keys only). "
            "A raw OpenAI or Anthropic API key cannot be used directly. Add an OpenRouter "
            "key (sk-or-…) and activate it, then choose models such as "
            f"{vendor}/… from the catalogue."
        ),
        "tips": [
            "Delete or deactivate this key and add a new key with provider OpenRouter.",
            f"After syncing models, filter the Models page by provider “{vendor}”.",
            "Optional: use Groq provider type only for Groq-hosted models.",
        ],
        "models_filter": vendor if vendor in ("openai", "anthropic") else None,
        "chat_model_hint": f"After switching to OpenRouter, select provider {vendor} and a model.",
        "misconfigured": True,
    }


def get_active_key_context() -> dict[str, Any]:
    """Context for UI banners: routing, models, balance, guidance."""
    row = _active_key_row()
    env_or = os.environ.get("OPENROUTER_API_KEY", "").strip()
    env_groq = os.environ.get("GROQ_API_KEY", "").strip()

    if not row and not env_or and not env_groq:
        return {
            "has_active_key": False,
            "key_provider": None,
            "routing": None,
            "guide": {
                "title": "No API key configured",
                "summary": "Add an OpenRouter or Groq API key to start chatting.",
                "tips": ["Settings → API Keys → Add key", "Or set OPENROUTER_API_KEY in .env"],
            },
            "models": {"total": _count_models(), "sample": _sample_models(), "filter_hint": None},
            "balance": {
                "available": False,
                "message": "Add a key to check provider balance.",
            },
        }

    if row:
        stored = str(row["provider"] or "openrouter")
        routing = _resolve_routing(stored)
        try:
            key_value = decrypt_secret(str(row["key_value"]))
        except Exception:
            key_value = ""
    else:
        stored = "openrouter" if env_or else "groq"
        routing = ROUTING_OPENROUTER if env_or else ROUTING_GROQ
        key_value = env_or or env_groq

    guide = _guide_for(stored, routing)
    model_filter = guide.get("models_filter")
    total = _count_models(provider_filter=model_filter if isinstance(model_filter, str) else None)

    balance: dict[str, Any]
    if routing == ROUTING_OPENROUTER and key_value:
        balance = _openrouter_balance(key_value)
    elif routing == ROUTING_GROQ:
        balance = {
            "available": False,
            "source": "groq",
            "label": "Groq account",
            "message": (
                "Groq does not expose a spend balance via this app. "
                "Check usage and limits at console.groq.com."
            ),
        }
    else:
        balance = {
            "available": False,
            "source": stored,
            "label": "Provider balance",
            "message": (
                "Balance cannot be read for this key type. "
                "Switch to an OpenRouter key to see credits here."
            ),
        }

    return {
        "has_active_key": True,
        "key_name": row["name"] if row else "Environment",
        "key_preview": row["key_preview"] if row else "(env)",
        "key_provider": stored,
        "routing": routing,
        "guide": guide,
        "models": {
            "total": total,
            "sample": _sample_models(
                provider_filter=model_filter if isinstance(model_filter, str) else None
            ),
            "filter_hint": model_filter,
        },
        "balance": balance,
    }
