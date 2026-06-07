"""Currency exchange rate service — fetches from open.er-api.com and caches daily."""
from __future__ import annotations

import logging
from datetime import datetime

import requests

from backend.db import db_connection

logger = logging.getLogger(__name__)

SUPPORTED_CURRENCIES = ["GBP", "EUR", "INR", "CNY", "JPY", "AUD"]
_RATES_API_URL = "https://open.er-api.com/v6/latest/USD"


def get_currency_rates() -> dict[str, float]:
    """Return today's exchange rates (1 USD → N currency), fetching from API if not cached."""
    today = datetime.now().strftime("%Y-%m-%d")

    with db_connection() as conn:
        rows = conn.execute(
            "SELECT currency_code, rate FROM currency_rates WHERE fetched_date = ?",
            [today],
        ).fetchall()

    cached: dict[str, float] = {r["currency_code"]: float(r["rate"]) for r in rows}

    if all(c in cached for c in SUPPORTED_CURRENCIES):
        return cached

    try:
        resp = requests.get(_RATES_API_URL, timeout=10)
        data: dict = resp.json()
        if data.get("result") == "success":
            api_rates: dict[str, float] = data["rates"]
            with db_connection() as conn:
                for code in SUPPORTED_CURRENCIES:
                    if code in api_rates:
                        conn.execute(
                            """INSERT OR REPLACE INTO currency_rates
                               (currency_code, rate, fetched_date) VALUES (?, ?, ?)""",
                            [code, api_rates[code], today],
                        )
                        cached[code] = float(api_rates[code])
    except Exception as exc:
        logger.warning("Failed to fetch currency rates: %s", exc)

    return cached
