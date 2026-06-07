import logging

from backend.db import db_connection

logger = logging.getLogger(__name__)


def pricing_router_for_provider(provider: str) -> str:
    if provider == "groq":
        return "groq"
    if provider == "ollama":
        return "ollama"
    return "openrouter"


def upsert_model_pricing(
    provider: str,
    model: str,
    input_per_million: float,
    output_per_million: float,
    router: str = "openrouter",
    description: str | None = None,
    category: str | None = None,
    context_length: int | None = None,
    is_local: int = 0,
    sync_source: str | None = None,
) -> None:
    with db_connection() as conn:
        conn.execute(
            """
            INSERT INTO model_pricing
                (router, provider, model, category, description,
                 context_length, input_per_million, output_per_million,
                 status, is_local, sync_source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            ON CONFLICT (router, provider, model) DO UPDATE SET
                category           = excluded.category,
                description        = excluded.description,
                context_length     = excluded.context_length,
                input_per_million  = excluded.input_per_million,
                output_per_million = excluded.output_per_million,
                status             = 'active',
                is_local           = excluded.is_local,
                sync_source        = excluded.sync_source,
                last_updated       = strftime('%Y-%m-%dT%H:%M:%f', 'now')
            """,
            (router, provider, model, category, description,
             context_length, input_per_million, output_per_million, is_local, sync_source),
        )
    logger.info("Upserted pricing for %s/%s/%s", router, provider, model)


def expire_missing_models(router: str, active_ids: set[str]) -> int:
    """Set status='expired' for models on this router absent from the latest fetch.

    active_ids: set of 'provider/model' strings returned by the API.
    """
    if not active_ids:
        return 0
    placeholders = ",".join("?" * len(active_ids))
    with db_connection() as conn:
        cursor = conn.execute(
            f"""
            UPDATE model_pricing
            SET status = 'expired',
                last_updated = strftime('%Y-%m-%dT%H:%M:%f', 'now')
            WHERE router = ?
              AND status = 'active'
              AND (provider || '/' || model) NOT IN ({placeholders})
            """,
            (router, *active_ids),
        )
    expired: int = cursor.rowcount
    if expired:
        logger.info("Expired %d models no longer returned by %s", expired, router)
    return expired


def insert_credits(
    total_credits: float | None,
    total_usage: float | None,
) -> int:
    """Insert a snapshot of OpenRouter credit totals into the balance table.

    Returns the number of rows inserted (0-2).
    """
    rows: list[tuple[float, str]] = []
    if total_credits is not None and total_credits != 0:
        rows.append((total_credits, "OpenRouter total credits purchased"))
    if total_usage is not None and total_usage != 0:
        rows.append((-total_usage, "OpenRouter total usage (negated)"))

    if not rows:
        return 0

    with db_connection() as conn:
        for amount, description in rows:
            conn.execute(
                "INSERT INTO balance (amount, description) VALUES (?, ?)",
                (amount, description),
            )

    logger.info("Inserted %d credit row(s) into balance table", len(rows))
    return len(rows)


def get_model_pricing(
    provider: str,
    model: str,
    router: str | None = None,
) -> tuple[float, float]:
    resolved_router = router or pricing_router_for_provider(provider)
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT input_per_million, output_per_million
            FROM model_pricing
            WHERE router = ? AND provider = ? AND model = ?
            """,
            (resolved_router, provider, model),
        ).fetchone()

    if row is None:
        raise ValueError(f"No pricing found for {resolved_router}/{provider}/{model}")

    return float(row[0]), float(row[1])
