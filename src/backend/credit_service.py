from __future__ import annotations

import logging
import sqlite3

from backend.db import db_connection, execute_with_retry

logger = logging.getLogger(__name__)


def add_credit(amount: float, description: str, *, conn: sqlite3.Connection | None = None) -> None:
    if amount <= 0:
        raise ValueError("Credit amount must be positive")
    _record_transaction(amount, description, conn=conn)


def deduct_credit(
    amount: float,
    description: str,
    conversation_id: int | None = None,
    *,
    conn: sqlite3.Connection | None = None,
) -> None:
    if amount <= 0:
        raise ValueError("Deduction amount must be positive")
    _record_transaction(-amount, description, conversation_id=conversation_id, conn=conn)


def get_balance() -> float:
    with db_connection() as conn:
        row = conn.execute("SELECT COALESCE(SUM(amount), 0) FROM balance").fetchone()
    return float(row[0])


def _record_transaction(
    amount: float,
    description: str,
    conversation_id: int | None = None,
    *,
    conn: sqlite3.Connection | None = None,
) -> None:
    sql = "INSERT INTO balance (amount, description, conversation_id) VALUES (?, ?, ?)"
    params = (amount, description, conversation_id)
    if conn is not None:
        execute_with_retry(conn, sql, params)
    else:
        with db_connection() as owned:
            execute_with_retry(owned, sql, params)
    logger.info("Balance transaction: %+.8f — %s", amount, description)
