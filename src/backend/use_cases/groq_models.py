"""Groq catalogue: fixed set of supported models and sync into model_pricing."""

from __future__ import annotations

import logging

from fastapi import HTTPException

from backend.config import GROQ_SUPPORTED_MODELS
from backend.db import db_connection
from backend.pricing_service import expire_missing_models, upsert_model_pricing

logger = logging.getLogger(__name__)

# (model_id, input $/1M, output $/1M, description) — per Groq pricing docs.
_GROQ_SPECS: tuple[tuple[str, float, float, str], ...] = (
    ("llama-3.1-8b-instant", 0.05, 0.08, "Llama 3.1 8B on Groq"),
    ("llama-3.3-70b-versatile", 0.59, 0.79, "Llama 3.3 70B on Groq"),
    ("openai/gpt-oss-120b", 0.15, 0.60, "GPT OSS 120B on Groq"),
    ("openai/gpt-oss-20b", 0.075, 0.30, "GPT OSS 20B on Groq"),
)


def groq_catalog_count() -> int:
    with db_connection() as conn:
        n = conn.execute(
            """
            SELECT COUNT(*) FROM model_pricing
            WHERE router = 'groq' AND provider = 'groq' AND status = 'active'
            """
        ).fetchone()[0]
    return int(n)


def ensure_groq_catalog() -> None:
    """Upsert Groq models if the catalogue is empty or incomplete."""
    if groq_catalog_count() >= len(GROQ_SUPPORTED_MODELS):
        return
    sync_groq_models()


def sync_groq_models() -> str:
    """Upsert the four supported Groq models; expire any other groq router rows."""
    active_ids: set[str] = set()
    for model_id, inp, out, desc in _GROQ_SPECS:
        if model_id not in GROQ_SUPPORTED_MODELS:
            continue
        upsert_model_pricing(
            provider="groq",
            model=model_id,
            input_per_million=inp,
            output_per_million=out,
            router="groq",
            description=desc,
            category="text",
            context_length=131_072,
            sync_source="groq_catalog",
        )
        active_ids.add(f"groq/{model_id}")
    expired = expire_missing_models("groq", active_ids)
    msg = f"Groq catalogue: {len(active_ids)} model(s), expired {expired}"
    logger.info(msg)
    return msg


def assert_groq_model_allowed(*, provider: str, model: str) -> None:
    if provider != "groq":
        return
    if model in GROQ_SUPPORTED_MODELS:
        return
    allowed = ", ".join(sorted(GROQ_SUPPORTED_MODELS))
    raise HTTPException(
        400,
        f"Unsupported Groq model '{model}'. Supported models: {allowed}",
    )
