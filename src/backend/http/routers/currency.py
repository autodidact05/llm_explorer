from __future__ import annotations

from fastapi import APIRouter

from backend.currency_service import get_currency_rates

router = APIRouter()


@router.get("/api/currency")
def get_currency() -> dict[str, float]:
    return get_currency_rates()

