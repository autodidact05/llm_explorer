from __future__ import annotations

import logging
import os
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.crypto_service import decrypt_secret, encrypt_secret
from backend.use_cases.agent_client import reset_agent_clients
from backend.db import db_connection
from backend.use_cases import startup
from backend.use_cases.llm_routing import (
    ROUTING_GROQ,
    ROUTING_OPENROUTER,
    activate_key_for_lane,
    apply_active_llm_routing,
    get_routing_status,
    routing_lane_for_stored_provider,
    set_active_llm_routing,
)
from backend.use_cases.provider_key_context import get_active_key_context

logger = logging.getLogger(__name__)

router = APIRouter()


class ApiKeyCreate(BaseModel):
    name: str
    provider: str = "openrouter"
    key_value: str


class RoutingUpdate(BaseModel):
    routing: Literal["openrouter", "groq"]


@router.get("/api/keys/active-context")
def active_key_context() -> dict[str, Any]:
    return get_active_key_context()


@router.get("/api/keys/routing")
def llm_routing_status() -> dict[str, Any]:
    return get_routing_status()


@router.put("/api/keys/routing")
def set_llm_routing(body: RoutingUpdate) -> dict[str, Any]:
    set_active_llm_routing(body.routing)
    apply_active_llm_routing()
    return get_routing_status()


@router.get("/api/keys")
def list_api_keys() -> list[dict[str, Any]]:
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, provider, key_preview, is_active, created_at "
            "FROM api_keys ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/api/keys")
def add_api_key(body: ApiKeyCreate) -> dict[str, Any]:
    key = body.key_value.strip()
    if not key:
        raise HTTPException(400, "key_value cannot be empty")
    preview = f"{key[:8]}..." if len(key) >= 8 else "***"
    stored = encrypt_secret(key)
    with db_connection() as conn:
        cur = conn.execute(
            "INSERT INTO api_keys (name, provider, key_value, key_preview) VALUES (?, ?, ?, ?)",
            [body.name.strip() or "Unnamed", body.provider, stored, preview],
        )
        key_id = cur.lastrowid
        row = conn.execute(
            "SELECT id, name, provider, key_preview, is_active, created_at "
            "FROM api_keys WHERE id = ?",
            [key_id],
        ).fetchone()
    return dict(row)


@router.put("/api/keys/{key_id}/activate")
def activate_api_key(key_id: int) -> dict[str, str]:
    with db_connection() as conn:
        row = conn.execute(
            "SELECT id, provider, key_value FROM api_keys WHERE id = ?",
            [key_id],
        ).fetchone()
        if not row:
            raise HTTPException(404, "API key not found")

    provider = str(row["provider"] or "openrouter")
    key_value = decrypt_secret(str(row["key_value"]))
    lane = activate_key_for_lane(
        key_id=int(row["id"]),
        stored_provider=provider,
        key_value=key_value,
    )
    reset_agent_clients()

    try:
        if lane == ROUTING_OPENROUTER:
            startup.first_run_balance_init(api_key=key_value)
    except Exception as exc:
        logger.warning("Balance init on key activation failed: %s", exc)

    return {"status": "activated", "routing": lane}


@router.delete("/api/keys/{key_id}")
def delete_api_key(key_id: int) -> dict[str, Any]:
    with db_connection() as conn:
        row = conn.execute(
            "SELECT id, provider FROM api_keys WHERE id = ?", [key_id]
        ).fetchone()
        if not row:
            raise HTTPException(404, "API key not found")
        lane = routing_lane_for_stored_provider(str(row["provider"]))
        conn.execute("DELETE FROM api_keys WHERE id = ?", [key_id])

    apply_active_llm_routing()
    status = get_routing_status()
    if status["active_routing"] is None:
        if lane == ROUTING_GROQ:
            os.environ.pop("GROQ_API_KEY", None)
        else:
            os.environ.pop("OPENROUTER_API_KEY", None)
        remaining = ROUTING_OPENROUTER if lane == ROUTING_GROQ else ROUTING_GROQ
        if status[remaining]["configured"]:
            try:
                set_active_llm_routing(remaining)
                apply_active_llm_routing()
            except HTTPException:
                pass

    return {"deleted": True, "id": key_id}
