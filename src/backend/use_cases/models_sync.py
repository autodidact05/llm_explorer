from __future__ import annotations

import csv
import json
import logging
from typing import Any, Literal

import requests

import backend.config as _config
from backend.config import is_allowed_openrouter_provider
from backend.pricing_service import expire_missing_models, upsert_model_pricing

logger = logging.getLogger(__name__)

MODELS_URL = "https://openrouter.ai/api/v1/models"
ROUTER = "openrouter"

CSV_FIELDS = [
    "router",
    "provider",
    "model",
    "category",
    "description",
    "context_length",
    "input_per_million",
    "output_per_million",
]


def _process_api_models(models: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    rows: list[dict[str, Any]] = []
    skipped = 0
    for m in models:
        model_id = str(m.get("id", ""))
        if "/" not in model_id:
            skipped += 1
            continue

        provider, model_name = model_id.split("/", 1)
        if not is_allowed_openrouter_provider(provider):
            skipped += 1
            continue

        pricing: dict[str, str] = m.get("pricing") or {}  # type: ignore[assignment]

        try:
            input_per_million = float(pricing.get("prompt") or "0") * 1_000_000
            output_per_million = float(pricing.get("completion") or "0") * 1_000_000
        except (ValueError, TypeError):
            logger.warning("Skipping %s — could not parse pricing", model_id)
            skipped += 1
            continue

        if input_per_million < 0 or output_per_million < 0:
            logger.warning("Skipping %s — pricing unavailable (negative sentinel)", model_id)
            skipped += 1
            continue

        arch: dict[str, Any] = m.get("architecture") or {}  # type: ignore[assignment]
        context_length = m.get("context_length")

        rows.append(
            {
                "router": ROUTER,
                "provider": provider,
                "model": model_name,
                "category": str(arch["modality"]) if arch.get("modality") else None,
                "description": str(m["description"]) if m.get("description") else None,
                "context_length": int(context_length) if context_length is not None else None,
                "input_per_million": input_per_million,
                "output_per_million": output_per_million,
            }
        )

    return rows, skipped


def _save_csv(rows: list[dict[str, Any]]) -> None:
    _config.MODELS_CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _config.MODELS_CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _load_csv() -> list[dict[str, Any]]:
    if not _config.MODELS_CSV_PATH.exists():
        raise FileNotFoundError(
            f"Local model CSV not found at {_config.MODELS_CSV_PATH}. "
            "Sync from OpenRouter once to create the cache."
        )
    with _config.MODELS_CSV_PATH.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))  # type: ignore[return-value]


def _upsert_rows(
    rows: list[dict[str, Any]],
    *,
    is_local: int,
    sync_source: str,
) -> tuple[set[str], int]:
    active_ids: set[str] = set()
    skipped = 0
    for row in rows:
        provider = str(row["provider"])
        model_name = str(row["model"])
        try:
            input_pm = float(row["input_per_million"])
            output_pm = float(row["output_per_million"])
        except (ValueError, TypeError):
            logger.warning("Skipping %s/%s — bad pricing in row", provider, model_name)
            skipped += 1
            continue

        raw_ctx = row.get("context_length")
        context_length = (
            int(raw_ctx) if raw_ctx not in (None, "", "None") else None
        )

        raw_cat = row.get("category")
        category = str(raw_cat) if raw_cat not in (None, "", "None") else None

        raw_desc = row.get("description")
        description = str(raw_desc) if raw_desc not in (None, "", "None") else None

        upsert_model_pricing(
            router=str(row.get("router") or ROUTER),
            provider=provider,
            model=model_name,
            input_per_million=input_pm,
            output_per_million=output_pm,
            description=description,
            category=category,
            context_length=context_length,
            is_local=is_local,
            sync_source=sync_source,
        )
        active_ids.add(f"{provider}/{model_name}")

    return active_ids, skipped


def sync_openrouter_models(
    *,
    source: Literal["openrouter", "local"],
    api_key: str | None = None,
) -> tuple[str, str]:
    stderr = ""

    use_local = source == "local"
    if use_local:
        rows = [
            r for r in _load_csv()
            if is_allowed_openrouter_provider(str(r["provider"]))
        ]
        skipped_parse = 0
        sync_source = "local_csv"
        is_local = 0
    else:
        if not api_key:
            raise RuntimeError("No API key available for OpenRouter model sync.")
        resp = requests.get(
            MODELS_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        if not resp.ok:
            try:
                detail = (resp.json().get("error") or {}).get("message") or resp.text[:300]
            except Exception:
                detail = resp.text[:300]
            raise RuntimeError(f"OpenRouter returned HTTP {resp.status_code}: {detail}")

        raw = resp.json()
        models = raw.get("data", [])
        if not isinstance(models, list):
            raise RuntimeError("Unexpected OpenRouter /models response shape")
        rows, skipped_parse = _process_api_models(models)  # type: ignore[arg-type]
        _save_csv(rows)
        sync_source = "openrouter_api"
        is_local = 0

    active_ids, skipped_upsert = _upsert_rows(rows, is_local=is_local, sync_source=sync_source)
    expired = expire_missing_models(ROUTER, active_ids)

    source_label = f"local ({_config.MODELS_CSV_PATH.name})" if use_local else "OpenRouter"
    output = (
        f"--- Model Sync ({source_label}) ---\n"
        f"Upserted : {len(active_ids)}\n"
        f"Expired  : {expired}\n"
        f"Skipped  : {skipped_parse + skipped_upsert}\n"
    )
    return output, stderr


def pretty_json(data: object) -> str:
    return json.dumps(data, indent=2, sort_keys=True)

