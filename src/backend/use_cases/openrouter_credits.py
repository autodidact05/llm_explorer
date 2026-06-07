from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import requests

from backend.db import db_connection

logger = logging.getLogger(__name__)

AUTH_KEY_URL = "https://openrouter.ai/api/v1/auth/key"
CREDITS_URL = "https://openrouter.ai/api/v1/credits"


def _safe_json(resp: requests.Response) -> dict[str, Any]:
    try:
        raw = resp.json()
    except ValueError:
        return {}
    return raw if isinstance(raw, dict) else {}


def fetch_openrouter_key_info(api_key: str) -> dict[str, Any]:
    resp = requests.get(
        AUTH_KEY_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=15,
    )
    if not resp.ok:
        detail = (_safe_json(resp).get("error") or {}).get("message") or resp.text[:300]
        raise RuntimeError(f"OpenRouter returned HTTP {resp.status_code}: {detail}")
    raw = _safe_json(resp)
    data = raw.get("data")
    return data if isinstance(data, dict) else raw


def fetch_openrouter_credits(api_key: str) -> dict[str, Any]:
    resp = requests.get(
        CREDITS_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=15,
    )
    if not resp.ok:
        detail = (_safe_json(resp).get("error") or {}).get("message") or resp.text[:300]
        raise RuntimeError(f"OpenRouter returned HTTP {resp.status_code}: {detail}")
    raw = _safe_json(resp)
    data = raw.get("data")
    return data if isinstance(data, dict) else raw


def fetch_and_reconcile_credits(*, api_key: str, check_today: bool = False) -> dict[str, Any]:
    """Fetch OpenRouter credits and reconcile the DB balance.

    Raises RuntimeError on network or API errors so callers can surface the message.
    """
    data = fetch_openrouter_key_info(api_key)

    usage = float(data.get("usage", 0) or 0)
    limit = data.get("limit")
    synced = False
    added_amount: float | None = None

    # For unlimited keys (limit is None), try /credits for purchased credit balance
    if limit is None:
        try:
            credits = fetch_openrouter_credits(api_key)
        except RuntimeError as exc:
            logger.info("OpenRouter /credits fetch failed (continuing): %s", exc)
        else:
            total_credits = credits.get("total_credits")
            total_usage = credits.get("total_usage")
            if total_credits is not None:
                limit = float(total_credits)
                if total_usage is not None:
                    usage = float(total_usage)

    has_credits_data = limit is not None

    if limit is not None:
        remaining = float(limit) - usage
        with db_connection() as conn:
            if check_today:
                today = datetime.now().strftime("%Y-%m-%d")
                already = conn.execute(
                    "SELECT id FROM balance WHERE description LIKE 'OpenRouter sync%' "
                    "AND created_at >= ?",
                    [f"{today}T00:00:00"],
                ).fetchone()
                if already:
                    return {**data, "synced": False, "added_amount": None, "has_credits_data": True}

            current = float(
                conn.execute("SELECT COALESCE(SUM(amount), 0) FROM balance").fetchone()[0]
            )
            delta = remaining - current
            if abs(delta) > 0.000001:
                conn.execute(
                    "INSERT INTO balance (amount, description) VALUES (?, ?)",
                    [
                        round(delta, 6),
                        f"OpenRouter sync: ${remaining:.4f} remaining "
                        f"(${usage:.4f} used of ${float(limit):.4f} total)",
                    ],
                )
                synced = True
                added_amount = round(delta, 6)

    return {
        **data,
        "synced": synced,
        "added_amount": added_amount,
        "has_credits_data": has_credits_data,
    }

