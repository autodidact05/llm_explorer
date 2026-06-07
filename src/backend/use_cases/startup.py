from __future__ import annotations

import asyncio
import logging

import backend.config as _config
from backend.db import db_connection
from backend.use_cases import models_sync, openrouter_credits

logger = logging.getLogger(__name__)


def first_run_balance_init(*, api_key: str) -> None:
    """Initialize balance once, from OpenRouter totals, when balance is empty."""
    with db_connection() as conn:
        count = conn.execute("SELECT COUNT(*) FROM balance").fetchone()[0]
    if count > 0:
        return

    try:
        credits = openrouter_credits.fetch_openrouter_credits(api_key)
    except RuntimeError as exc:
        logger.warning("First-run balance init: %s", exc)
        return

    total_credits = credits.get("total_credits")
    total_usage = credits.get("total_usage")

    with db_connection() as conn:
        if total_credits is not None and float(total_credits) != 0:
            conn.execute(
                "INSERT INTO balance (amount, description) VALUES (?, ?)",
                (float(total_credits), "Credits purchased (total as of first app run)"),
            )
        if total_usage is not None and float(total_usage) > 0:
            conn.execute(
                "INSERT INTO balance (amount, description) VALUES (?, ?)",
                (-float(total_usage), "Usage incurred before first app run"),
            )

    logger.info(
        "First-run balance initialized: total_credits=%s, total_usage=%s",
        total_credits,
        total_usage,
    )


def startup_models_sync(*, api_key: str | None) -> None:
    """Populate model_pricing when empty, using local CSV if available."""
    with db_connection() as conn:
        count = conn.execute("SELECT COUNT(*) FROM model_pricing").fetchone()[0]
    if count > 0:
        return

    use_local = _config.MODELS_CSV_PATH.exists()
    if use_local:
        source = "local"
        key = None
    else:
        if not api_key:
            logger.info("Startup models sync: no API key and no local CSV, skipping")
            return
        source = "openrouter"
        key = api_key

    try:
        output, _stderr = models_sync.sync_openrouter_models(source=source, api_key=key)  # type: ignore[arg-type]
    except Exception as exc:
        logger.warning("Startup models sync failed: %s", exc)
        return

    logger.info("Startup models sync complete:\n%s", output.strip())


async def run_startup_jobs(*, api_key: str | None) -> None:
    """On startup: first-run balance init, daily reconcile, populate models."""
    if api_key:
        try:
            await asyncio.to_thread(first_run_balance_init, api_key=api_key)
        except Exception as exc:
            logger.warning("First-run balance init failed: %s", exc)

        try:
            def _reconcile() -> None:
                openrouter_credits.fetch_and_reconcile_credits(
                    api_key=api_key,
                    check_today=True,
                )

            await asyncio.to_thread(_reconcile)
        except Exception as exc:
            logger.warning("Startup balance reconcile failed: %s", exc)

    try:
        await asyncio.to_thread(startup_models_sync, api_key=api_key)
    except Exception as exc:
        logger.warning("Startup models sync failed: %s", exc)


def get_active_api_key_or_none() -> str | None:
    from backend.llm_common import get_active_api_key

    try:
        return get_active_api_key()
    except RuntimeError:
        return None
