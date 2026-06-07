from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from backend.use_cases import openrouter_credits, startup

router = APIRouter()


@router.get("/api/openrouter/credits")
def get_openrouter_credits() -> dict[str, Any]:
    api_key = startup.get_active_api_key_or_none()
    if not api_key:
        raise HTTPException(400, "No API key configured. Add one in Settings.")
    try:
        return openrouter_credits.fetch_openrouter_key_info(api_key)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.post("/api/openrouter/credits/sync")
def sync_openrouter_credits() -> dict[str, Any]:
    api_key = startup.get_active_api_key_or_none()
    if not api_key:
        raise HTTPException(400, "No API key configured. Add one in Settings.")
    try:
        return openrouter_credits.fetch_and_reconcile_credits(api_key=api_key)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc

