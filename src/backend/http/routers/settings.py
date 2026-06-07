from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from backend.repos.settings_keys import SettingsKey
from backend.repos.settings_repo import get_settings, upsert_settings
from backend.use_cases.routing_defaults import DEFAULT_ROUTER_MODEL, DEFAULT_ROUTER_PROVIDER

router = APIRouter()

def _as_bool(v: str | None) -> bool:
    if v is None:
        return False
    return v.strip() in ("1", "true", "True", "yes", "on")


@router.get("/api/settings")
def get_app_settings() -> dict[str, object]:
    raw = get_settings(
        [
            SettingsKey.GENERIC_SYSTEM_MESSAGE,
            SettingsKey.ROUTER_LLM_ENABLED,
            SettingsKey.ROUTER_LLM_SYSTEM_MESSAGE,
            SettingsKey.ROUTER_LLM_PROVIDER,
            SettingsKey.ROUTER_LLM_MODEL,
        ]
    )
    return {
        "generic_system_message": raw.get(SettingsKey.GENERIC_SYSTEM_MESSAGE) or "",
        "router_llm_enabled": _as_bool(raw.get(SettingsKey.ROUTER_LLM_ENABLED)),
        "router_llm_system_message": raw.get(SettingsKey.ROUTER_LLM_SYSTEM_MESSAGE) or "",
        "router_llm_provider": raw.get(SettingsKey.ROUTER_LLM_PROVIDER) or DEFAULT_ROUTER_PROVIDER,
        "router_llm_model": raw.get(SettingsKey.ROUTER_LLM_MODEL) or DEFAULT_ROUTER_MODEL,
    }


class SettingsUpdate(BaseModel):
    generic_system_message: str | None = None
    router_llm_enabled: bool | None = None
    router_llm_system_message: str | None = None
    router_llm_provider: str | None = None
    router_llm_model: str | None = None


@router.put("/api/settings")
def update_app_settings(body: SettingsUpdate) -> dict[str, str]:
    updates: dict[str, str] = {}
    if body.generic_system_message is not None:
        updates[SettingsKey.GENERIC_SYSTEM_MESSAGE] = body.generic_system_message
    if body.router_llm_enabled is not None:
        updates[SettingsKey.ROUTER_LLM_ENABLED] = "1" if body.router_llm_enabled else "0"
    if body.router_llm_system_message is not None:
        updates[SettingsKey.ROUTER_LLM_SYSTEM_MESSAGE] = body.router_llm_system_message
    if body.router_llm_provider is not None:
        updates[SettingsKey.ROUTER_LLM_PROVIDER] = body.router_llm_provider.strip()
    if body.router_llm_model is not None:
        updates[SettingsKey.ROUTER_LLM_MODEL] = body.router_llm_model.strip()
    upsert_settings(updates)
    return {"status": "ok"}
