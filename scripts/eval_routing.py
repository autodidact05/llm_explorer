"""Offline-ish Router LLM evaluation harness.

Runs a small set of prompts through the Router LLM and prints the parsed decision.

Usage:
  uv run python scripts/eval_routing.py --prompts data/routing_eval_prompts.jsonl

Prompt file format (JSONL):
  {"id":"p1","prompt":"..."}
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

from backend.config import openrouter_provider_sql_clause
from backend.db import db_connection
from backend.use_cases.routing_defaults import DEFAULT_ROUTER_SYSTEM_MESSAGE
from backend.init_db import initialize_database
from backend.repos.settings_repo import get_settings
from backend.use_cases.router_agent import invoke_router_agent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger(__name__)


def _load_prompts(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prompts",
        type=Path,
        default=Path("data") / "routing_eval_prompts.jsonl",
        help="JSONL file with prompts to evaluate.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Maximum prompts to run.",
    )
    args = parser.parse_args()

    initialize_database()
    if not args.prompts.exists():
        raise SystemExit(f"Prompt file not found: {args.prompts}")

    prompts = _load_prompts(args.prompts)[: args.limit]

    provider_clause, provider_params = openrouter_provider_sql_clause()
    with db_connection() as conn:
        avail = conn.execute(
            f"""SELECT provider, model, category, input_per_million, output_per_million
               FROM model_pricing
               WHERE status = 'active' AND is_local = 0 AND {provider_clause}
               ORDER BY input_per_million LIMIT 40""",
            provider_params,
        ).fetchall()

    settings = get_settings(["router_llm_system_message", "router_llm_provider", "router_llm_model"])
    router_system = settings.get("router_llm_system_message") or DEFAULT_ROUTER_SYSTEM_MESSAGE
    router_provider = settings.get("router_llm_provider") or "openai"
    router_model = settings.get("router_llm_model") or "gpt-4o-mini"
    curated_models = [dict(r) for r in avail]

    for p in prompts:
        pid = p.get("id") or "?"
        prompt = str(p.get("prompt") or "")

        logger.info("Routing %s…", pid)
        resp = invoke_router_agent(
            provider=router_provider,
            model=router_model,
            router_system=router_system,
            user_query=prompt,
            curated_models=curated_models,
            past_feedback=[],
            router_provider=router_provider,
            router_model=router_model,
        )
        decision = resp.get("decision")
        if not decision:
            raw = str(resp.get("content", ""))
            print(f"{pid}: PARSE_FAIL raw={raw[:200]!r}")
            continue
        print(
            f"{pid}: {decision.provider}/{decision.model} "
            f"cost={decision.estimated_cost or '-'} conf={decision.confidence or '-'} "
            f"reason={decision.reason or '-'}"
        )


if __name__ == "__main__":
    main()
