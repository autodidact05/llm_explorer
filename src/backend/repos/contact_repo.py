"""Persist user contact / feedback submissions."""

from __future__ import annotations

from typing import Any

from backend.db import db_connection, execute_with_retry


def insert_contact_submission(
    *,
    subject: str,
    message: str,
    rating: int,
    user_id: int | None = None,
    user_email: str | None = None,
) -> dict[str, Any]:
    with db_connection() as conn:
        cur = execute_with_retry(
            conn,
            """
            INSERT INTO contact_submissions (user_id, user_email, subject, message, rating)
            VALUES (?, ?, ?, ?, ?)
            """,
            [user_id, user_email, subject, message, rating],
        )
        row_id = int(cur.lastrowid)
        row = conn.execute(
            "SELECT id, subject, rating, created_at FROM contact_submissions WHERE id = ?",
            [row_id],
        ).fetchone()
    return dict(row)
