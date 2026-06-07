"""AI spend wallet ledger (stored in the ``balance`` table)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from backend.db import db_connection

router = APIRouter()


def _list_wallet(page: int, page_size: int) -> dict[str, Any]:
    offset = (page - 1) * page_size
    with db_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM balance").fetchone()[0]
        bal = conn.execute("SELECT COALESCE(SUM(amount), 0) FROM balance").fetchone()[0]
        rows = conn.execute(
            "SELECT id, created_at, amount, description, conversation_id FROM balance "
            "ORDER BY created_at DESC LIMIT ? OFFSET ?",
            [page_size, offset],
        ).fetchall()

    return {
        "wallet_balance": float(bal),
        "balance": float(bal),
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [dict(r) for r in rows],
    }


@router.get("/api/wallet")
def list_wallet(page: int = 1, page_size: int = 50) -> dict[str, Any]:
    return _list_wallet(page, page_size)


@router.get("/api/balance", include_in_schema=False)
def list_balance_legacy(page: int = 1, page_size: int = 50) -> dict[str, Any]:
    return _list_wallet(page, page_size)
