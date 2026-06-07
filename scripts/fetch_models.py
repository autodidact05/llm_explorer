"""Fetch all models and account credits from the OpenRouter API.

Usage:
    uv run python scripts/fetch_models.py           # fetch from OpenRouter (default)
    uv run python scripts/fetch_models.py --local   # load from local CSV cache
"""

import argparse
import csv
import json
import logging
import os
import urllib.request

import backend.config as _config
from backend.config import is_allowed_openrouter_provider
from backend.init_db import initialize_database
from backend.pricing_service import expire_missing_models, upsert_model_pricing

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger(__name__)

MODELS_URL = "https://openrouter.ai/api/v1/models"
CREDITS_URL = "https://openrouter.ai/api/v1/credits"
ROUTER = "openrouter"

CSV_FIELDS = [
    "router", "provider", "model", "category", "description",
    "context_length", "input_per_million", "output_per_million",
]


def _get(url: str, api_key: str | None = None) -> dict[str, object]:
    req = urllib.request.Request(url)
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())  # type: ignore[return-value]


def _process_api_models(
    models: list[dict[str, object]],
) -> tuple[list[dict[str, object]], int]:
    """Parse raw OpenRouter model list into normalized row dicts.

    Returns (rows, skipped_count).
    """
    rows: list[dict[str, object]] = []
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
            # Explicit "0" fallback so we never silently lose a tiny non-zero price
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

        arch: dict[str, object] = m.get("architecture") or {}  # type: ignore[assignment]
        context_length = m.get("context_length")

        rows.append({
            "router": ROUTER,
            "provider": provider,
            "model": model_name,
            "category": str(arch["modality"]) if arch.get("modality") else None,
            "description": str(m["description"]) if m.get("description") else None,
            "context_length": int(context_length) if context_length is not None else None,
            "input_per_million": input_per_million,
            "output_per_million": output_per_million,
        })

    return rows, skipped


def _save_csv(rows: list[dict[str, object]]) -> None:
    _config.MODELS_CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _config.MODELS_CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    logger.info("Saved %d models to %s", len(rows), _config.MODELS_CSV_PATH)


def _load_csv() -> list[dict[str, object]]:
    if not _config.MODELS_CSV_PATH.exists():
        raise FileNotFoundError(
            f"Local model CSV not found at {_config.MODELS_CSV_PATH}.\n"
            "Run without --local first to fetch from OpenRouter and save the cache."
        )
    with _config.MODELS_CSV_PATH.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))  # type: ignore[return-value]


def _upsert_rows(
    rows: list[dict[str, object]], is_local: int, sync_source: str | None = None
) -> tuple[set[str], int]:
    """Upsert normalized row dicts into model_pricing. Returns (active_ids, skipped)."""
    active_ids: set[str] = set()
    skipped = 0
    for row in rows:
        provider = str(row["provider"])
        model_name = str(row["model"])
        try:
            input_pm = float(row["input_per_million"])  # type: ignore[arg-type]
            output_pm = float(row["output_per_million"])  # type: ignore[arg-type]
        except (ValueError, TypeError):
            logger.warning("Skipping %s/%s — bad pricing in row", provider, model_name)
            skipped += 1
            continue

        raw_ctx = row.get("context_length")
        context_length = int(raw_ctx) if raw_ctx not in (None, "", "None") else None  # type: ignore[arg-type]

        raw_cat = row.get("category")
        category = str(raw_cat) if raw_cat not in (None, "", "None") else None  # type: ignore[arg-type]

        raw_desc = row.get("description")
        description = str(raw_desc) if raw_desc not in (None, "", "None") else None  # type: ignore[arg-type]

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


def fetch_credits(api_key: str) -> None:
    from backend.pricing_service import insert_credits

    payload = _get(CREDITS_URL, api_key)
    data: dict[str, object] = payload.get("data") or {}  # type: ignore[assignment]

    total_credits = data.get("total_credits")
    total_usage = data.get("total_usage")

    inserted = insert_credits(
        total_credits=float(total_credits) if total_credits is not None else None,
        total_usage=float(total_usage) if total_usage is not None else None,
    )

    print("\n--- OpenRouter Credits ---")
    if total_credits is not None:
        print(f"Total Credits : ${float(total_credits):.6f}")
    else:
        print("Total Credits : N/A")
    if total_usage is not None:
        print(f"Total Usage   : ${float(total_usage):.6f}")
    else:
        print("Total Usage   : N/A")
    if total_credits is not None and total_usage is not None:
        remaining = float(total_credits) - float(total_usage)
        print(f"Remaining     : ${remaining:.6f}")
    print(f"Rows inserted : {inserted}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--local",
        action="store_true",
        help="Load models from the local CSV cache instead of fetching from OpenRouter.",
    )
    parser.add_argument(
        "--skip-credits",
        action="store_true",
        help="Skip fetching credit balance (used by auto-startup to avoid double-writing).",
    )
    args = parser.parse_args()

    initialize_database()
    api_key = os.environ.get("OPENROUTER_API_KEY")

    use_local = args.local and _config.MODELS_CSV_PATH.exists()
    if args.local and not use_local:
        logger.warning("Local CSV not found at %s — falling back to OpenRouter",
                       _config.MODELS_CSV_PATH)

    # sync_source: 'openrouter_api' for direct fetch, 'local_csv' for cached
    sync_source = "local_csv" if use_local else "openrouter_api"

    if use_local:
        rows = [
            r for r in _load_csv()
            if is_allowed_openrouter_provider(str(r["provider"]))
        ]
        logger.info("Loaded %d models from local CSV", len(rows))
        skipped_parse = 0
    else:
        raw_models = _get(MODELS_URL, api_key)["data"]  # type: ignore[index]
        logger.info("Fetched %d models from OpenRouter", len(raw_models))
        rows, skipped_parse = _process_api_models(raw_models)  # type: ignore[arg-type]
        _save_csv(rows)

    active_ids, skipped_upsert = _upsert_rows(rows, is_local=1 if use_local else 0, sync_source=sync_source)
    expired = expire_missing_models(ROUTER, active_ids)

    source_label = f"local ({_config.MODELS_CSV_PATH.name})" if use_local else "OpenRouter"
    print(f"\n--- Model Sync ({source_label}) ---")
    print(f"Upserted : {len(active_ids)}")
    print(f"Expired  : {expired}")
    print(f"Skipped  : {skipped_parse + skipped_upsert}")

    if not use_local and not args.skip_credits:
        if api_key:
            fetch_credits(api_key)
        else:
            print("\nSet OPENROUTER_API_KEY in .env to fetch credit balance.")


if __name__ == "__main__":
    main()
