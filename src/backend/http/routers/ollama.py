from __future__ import annotations

from typing import Any

import requests
from fastapi import APIRouter, HTTPException

from backend.pricing_service import expire_missing_models, upsert_model_pricing

router = APIRouter()

_OLLAMA_BASE = "http://localhost:11434"


@router.get("/api/ollama/status")
def get_ollama_status() -> dict[str, Any]:
    try:
        resp = requests.get(f"{_OLLAMA_BASE}/api/tags", timeout=3)
    except requests.RequestException:
        return {"available": False, "model_count": 0}

    if not resp.ok:
        return {"available": False, "model_count": 0}

    models = (resp.json() or {}).get("models", [])
    return {"available": True, "model_count": len(models) if isinstance(models, list) else 0}


@router.post("/api/ollama/models/sync")
def sync_ollama_models() -> dict[str, Any]:
    try:
        resp = requests.get(f"{_OLLAMA_BASE}/api/tags", timeout=5)
    except requests.RequestException as exc:
        raise HTTPException(503, f"Cannot reach Ollama at {_OLLAMA_BASE}: {exc}") from exc
    if not resp.ok:
        raise HTTPException(resp.status_code, "Ollama API error")

    models: list[dict[str, Any]] = (resp.json() or {}).get("models", [])
    synced = 0
    active_ids: set[str] = set()
    for m in models:
        name: str = m.get("name") or m.get("model") or ""
        if not name:
            continue
        details: dict[str, Any] = m.get("details") or {}
        family = details.get("family") or "unknown"

        context_length: int | None = None
        model_info = m.get("model_info") or {}
        if not model_info:
            try:
                info = requests.post(
                    f"{_OLLAMA_BASE}/api/show",
                    json={"name": name},
                    timeout=5,
                )
                if info.ok:
                    model_info = (info.json() or {}).get("model_info") or {}
            except requests.RequestException:
                model_info = {}
        if model_info:
            for k in ("llama.context_length", "num_ctx", "context_length"):
                v = model_info.get(k)
                if v is not None:
                    try:
                        context_length = int(v)
                    except (TypeError, ValueError):
                        pass
                    break

        upsert_model_pricing(
            router="ollama",
            provider="ollama",
            model=name,
            input_per_million=0.0,
            output_per_million=0.0,
            description=f"Local Ollama model — {family} family",
            category="text->text",
            context_length=context_length,
            is_local=1,
            sync_source="ollama_local",
        )
        active_ids.add(f"ollama/{name}")
        synced += 1

    expired = expire_missing_models("ollama", active_ids)
    return {"synced": synced, "expired": expired}

