from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from backend.db import db_connection

router = APIRouter()


@router.get("/api/stats/trend")
def get_spending_trend(days: int = 7) -> list[dict[str, Any]]:
    """Return daily spending totals for the last N days (gaps filled with zeros)."""
    from datetime import date, timedelta

    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT DATE(created_at) AS day,
                   COALESCE(SUM(input_cost + output_cost), 0) AS cost,
                   COUNT(*) AS queries
            FROM usage_audit
            WHERE created_at >= DATE('now', ?)
            GROUP BY day
            ORDER BY day
            """,
            [f"-{days} days"],
        ).fetchall()

    cost_by_day = {r["day"]: {"cost": float(r["cost"]), "queries": r["queries"]} for r in rows}
    today = date.today()
    return [
        {
            "date": (today - timedelta(days=days - 1 - i)).isoformat(),
            **cost_by_day.get(
                (today - timedelta(days=days - 1 - i)).isoformat(),
                {"cost": 0.0, "queries": 0},
            ),
        }
        for i in range(days)
    ]


@router.get("/api/stats/trend/hourly")
def get_spending_trend_hourly() -> list[dict[str, Any]]:
    """Return hourly spending totals for the last 24 hours (gaps filled with zeros)."""
    from datetime import datetime, timedelta, timezone

    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT strftime('%Y-%m-%dT%H:00:00', created_at) AS hour,
                   COALESCE(SUM(input_cost + output_cost), 0) AS cost,
                   COUNT(*) AS queries
            FROM usage_audit
            WHERE created_at >= datetime('now', '-24 hours')
            GROUP BY hour
            ORDER BY hour
            """
        ).fetchall()

    cost_by_hour = {r["hour"]: {"cost": float(r["cost"]), "queries": r["queries"]} for r in rows}
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return [
        {
            "date": (now - timedelta(hours=23 - i)).strftime("%Y-%m-%dT%H:00:00"),
            **cost_by_hour.get(
                (now - timedelta(hours=23 - i)).strftime("%Y-%m-%dT%H:00:00"),
                {"cost": 0.0, "queries": 0},
            ),
        }
        for i in range(24)
    ]


@router.get("/api/stats")
def get_stats() -> dict[str, Any]:
    with db_connection() as conn:
        u = conn.execute(
            """
            SELECT
                COUNT(*)                                   AS total_queries,
                COALESCE(SUM(input_cost + output_cost), 0) AS total_cost,
                COALESCE(SUM(prompt_tokens + response_tokens), 0) AS total_tokens,
                COALESCE(AVG(time_taken), 0)               AS avg_time_taken
            FROM usage_audit
            """
        ).fetchone()
        model_counts = conn.execute(
            "SELECT status, COUNT(*) FROM model_pricing GROUP BY status"
        ).fetchall()
        balance = conn.execute("SELECT COALESCE(SUM(amount), 0) FROM balance").fetchone()[0]
        recent = conn.execute(
            """
            SELECT event_id, created_at, router, provider, model,
                   prompt_tokens, response_tokens, input_cost, output_cost,
                   time_taken, http_code
            FROM usage_audit
            ORDER BY created_at DESC LIMIT 10
            """
        ).fetchall()

    counts = {row[0]: row[1] for row in model_counts}
    return {
        "total_queries": u["total_queries"],
        "total_cost": float(u["total_cost"]),
        "total_tokens": u["total_tokens"],
        "avg_time_taken": float(u["avg_time_taken"]),
        "active_models": counts.get("active", 0),
        "expired_models": counts.get("expired", 0),
        "credit_balance": float(balance),
        "wallet_balance": float(balance),
        "recent_usage": [dict(r) for r in recent],
    }

