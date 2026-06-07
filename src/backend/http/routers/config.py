from __future__ import annotations

import logging
import os
import secrets as _secrets
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from backend.http.deps import get_user_id
from pydantic import BaseModel

import backend.config as _config
from backend.brave_search_service import get_brave_api_key
from backend.use_cases.agent_client import reset_agent_clients
from backend.secrets import persist_jwt_secret

logger = logging.getLogger(__name__)

router = APIRouter()


def _key_preview(key: str) -> str:
    if not key:
        return ""
    return f"{key[:8]}..." if len(key) >= 8 else "***"


@router.get("/api/config")
def get_config() -> dict[str, Any]:
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    brave_key = get_brave_api_key()
    return {
        "api_key_set": bool(openrouter_key),
        "api_key_preview": _key_preview(openrouter_key),
        "brave_api_key_set": bool(brave_key),
        "brave_api_key_preview": _key_preview(brave_key),
        "db_path": str(_config.DB_PATH),
        "log_path": str(_config.LOG_PATH),
        "models_csv_path": str(_config.MODELS_CSV_PATH),
        "local_csv_exists": _config.MODELS_CSV_PATH.exists(),
    }


class ConfigUpdate(BaseModel):
    api_key: str | None = None
    brave_api_key: str | None = None


@router.put("/api/config")
def update_config(body: ConfigUpdate) -> dict[str, str]:
    """Update runtime config (no disk writes)."""
    if body.api_key is not None:
        os.environ["OPENROUTER_API_KEY"] = body.api_key
        reset_agent_clients()
    if body.brave_api_key is not None:
        os.environ["BRAVE_API_KEY"] = body.brave_api_key
    return {"status": "ok"}


def _persist_env_key(*, key: str, value: str) -> None:
    env_path = _config.BASE_DIR / ".env"
    lines: list[str] = []
    if env_path.exists():
        with env_path.open(encoding="utf-8") as f:
            lines = f.readlines()

    updated = False
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}\n"
            updated = True
            break
    if not updated:
        lines.append(f"{key}={value}\n")

    with env_path.open("w", encoding="utf-8") as f:
        f.writelines(lines)


class PersistConfigRequest(BaseModel):
    api_key: str | None = None
    brave_api_key: str | None = None


@router.post("/api/admin/config/persist")
def persist_config(request: Request, body: PersistConfigRequest) -> dict[str, str]:
    """Explicit admin action to persist runtime config to `.env` (authenticated)."""
    get_user_id(request)
    if body.api_key is not None:
        api_key = body.api_key
    else:
        api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if body.brave_api_key is not None:
        brave_key = body.brave_api_key
    else:
        brave_key = get_brave_api_key()

    if body.api_key is not None:
        if not api_key:
            raise HTTPException(400, "api_key cannot be empty")
        _persist_env_key(key="OPENROUTER_API_KEY", value=api_key)
        logger.info("Persisted OPENROUTER_API_KEY to .env via admin endpoint")

    if body.brave_api_key is not None:
        if not brave_key:
            raise HTTPException(400, "brave_api_key cannot be empty")
        _persist_env_key(key="BRAVE_API_KEY", value=brave_key)
        logger.info("Persisted BRAVE_API_KEY to .env via admin endpoint")

    if body.api_key is None and body.brave_api_key is None:
        raise HTTPException(400, "No keys provided to persist")

    return {"status": "ok"}


class PersistJwtSecretRequest(BaseModel):
    rotate: bool = False


@router.post("/api/admin/jwt-secret/persist")
def persist_jwt_secret_admin(req: Request, body: PersistJwtSecretRequest) -> dict[str, Any]:
    """Explicit admin action to persist JWT secret under `data/` (authenticated)."""
    get_user_id(req)
    current: str | None = getattr(req.app.state, "jwt_secret", None)
    if current and not body.rotate:
        persist_jwt_secret(current)
        logger.info("Persisted existing JWT secret to data file via admin endpoint")
        return {"status": "ok", "rotated": False}

    new_secret = _secrets.token_hex(32)
    persist_jwt_secret(new_secret)
    req.app.state.jwt_secret = new_secret
    logger.info("Rotated and persisted JWT secret via admin endpoint")
    return {"status": "ok", "rotated": True}
