"""Phased chat preparation: context, router, and Brave web search."""

from __future__ import annotations

import concurrent.futures
import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from backend.brave_search_service import augment_messages_with_web_search
from backend.date_context import append_date_context
from backend.chat_timeouts import BRAVE_SEARCH_TIMEOUT_SEC, ROUTER_TIMEOUT_SEC
from backend.use_cases.llm_routing import catalog_sql_clause
from backend.audit_service import insert_usage_audit
from backend.db import db_connection, execute_with_retry
from backend.llm_common import LLMCallError
from backend.use_cases.image_gen_constants import IMAGE_GEN_MODEL, IMAGE_GEN_PROVIDER
from backend.use_cases.router_agent import invoke_router_agent
from backend.use_cases.routing import (
    curate_models_for_image_routing,
    curate_models_for_routing,
    is_image_generation_model,
)
from backend.use_cases.routing_defaults import DEFAULT_ROUTER_SYSTEM_MESSAGE, prompt_version

if TYPE_CHECKING:
    from backend.use_cases.chat.types import PreparedChatSend

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RouterMeta:
    routed: bool
    provider: str | None = None
    model: str | None = None
    reason: str | None = None
    estimated_cost: str | None = None
    confidence: float | None = None
    unavailable: bool = False

def apply_image_model_defaults(prepared: PreparedChatSend) -> None:
    if prepared.is_image_gen and not is_image_generation_model(
        prepared.actual_provider, prepared.actual_model
    ):
        prepared.actual_provider = IMAGE_GEN_PROVIDER
        prepared.actual_model = IMAGE_GEN_MODEL


def apply_router_phase(prepared: PreparedChatSend) -> None:
    """Run router LLM with a hard timeout; mutates *prepared* in place."""
    if not prepared.router_llm_enabled or prepared.use_router_llm is False:
        return

    t0 = time.perf_counter()
    with db_connection() as conn:
        catalog_clause, catalog_params = catalog_sql_clause()
        avail_rows = conn.execute(
            f"""SELECT provider, model, category, input_per_million, output_per_million,
                      context_length, description
               FROM model_pricing
               WHERE status = 'active' AND is_local = 0 AND {catalog_clause}
               ORDER BY provider, model""",
            catalog_params,
        ).fetchall()
        past_rows = conn.execute(
            """SELECT ci.provider, ci.model, ci.routing_reason,
                      rr.rating, rr.comment
               FROM routing_ratings rr
               JOIN chat_interactions ci ON ci.id = rr.interaction_id
               ORDER BY rr.created_at DESC LIMIT 20"""
        ).fetchall()

    avail = [dict(r) for r in avail_rows]
    past = [dict(r) for r in past_rows]
    avail_set = {(m["provider"], m["model"]) for m in avail}

    past_pm: set[tuple[str, str]] = {
        (r["provider"], r["model"]) for r in past if r.get("provider")
    }
    if prepared.is_image_gen:
        curated_models = curate_models_for_image_routing(avail, past_providers_models=past_pm)
    else:
        curated_models = curate_models_for_routing(avail, past_providers_models=past_pm)

    router_system = prepared.router_llm_system_msg or DEFAULT_ROUTER_SYSTEM_MESSAGE
    router_prompt_ver = prompt_version(router_system)
    router_messages: list[dict[str, Any]] = [
        {"role": "system", "content": append_date_context(router_system)},
        {"role": "user", "content": prepared.content},
    ]

    if not curated_models:
        if prepared.is_image_gen:
            logger.warning(
                "No image-generation models in catalog for router — using default image model"
            )
        else:
            logger.warning("Router catalog curation returned no models — skipping router")
        prepared.timing_ms["router"] = (time.perf_counter() - t0) * 1000
        return

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(
                invoke_router_agent,
                provider=prepared.router_provider,
                model=prepared.router_model,
                router_system=router_system,
                user_query=prepared.content,
                curated_models=curated_models,
                past_feedback=past,
                conversation_context=prepared.conversation_context,
                router_provider=prepared.router_provider,
                router_model=prepared.router_model,
                image_generation=prepared.is_image_gen,
            )
            mr = future.result(timeout=ROUTER_TIMEOUT_SEC)
    except concurrent.futures.TimeoutError:
        prepared.router_timed_out = True
        prepared.router_meta = RouterMeta(routed=False, unavailable=True)
        logger.warning("Router LLM timed out after %.0fs", ROUTER_TIMEOUT_SEC)
        prepared.timing_ms["router"] = (time.perf_counter() - t0) * 1000
        return
    except LLMCallError as exc:
        prepared.router_meta = RouterMeta(routed=False, unavailable=True)
        insert_usage_audit(
            provider=prepared.router_provider,
            model=prepared.router_model,
            prompt_tokens=0,
            response_tokens=0,
            input_cost=0.0,
            output_cost=0.0,
            time_taken=exc.time_taken,
            http_code=exc.http_code,
            prompt_messages=router_messages,
            response_content=f"ROUTER ERROR: {exc}",
            write_log=False,
            conversation_id=prepared.conv_id,
            session_id=prepared.session_id,
        )
        logger.warning("Router LLM unavailable: %s", exc)
        prepared.timing_ms["router"] = (time.perf_counter() - t0) * 1000
        return

    router_messages = mr["prompt_messages"]  # type: ignore[assignment]
    prepared.router_prompt_tokens = int(mr.get("prompt_tokens", 0))
    prepared.router_response_tokens = int(mr.get("response_tokens", 0))
    prepared.router_input_cost = float(mr.get("input_cost", 0))
    prepared.router_output_cost = float(mr.get("output_cost", 0))
    router_event_id = insert_usage_audit(
        provider=prepared.router_provider,
        model=prepared.router_model,
        prompt_tokens=prepared.router_prompt_tokens,
        response_tokens=prepared.router_response_tokens,
        input_cost=prepared.router_input_cost,
        output_cost=prepared.router_output_cost,
        time_taken=float(mr.get("time_taken", 0)),
        http_code=int(mr.get("http_code", 200)),
        prompt_messages=router_messages,
        response_content=str(mr.get("content", "")),
        write_log=False,
        conversation_id=prepared.conv_id,
        session_id=prepared.session_id,
    )

    raw_content = str(mr.get("content", ""))
    decision = mr.get("decision")

    if decision:
        if (decision.provider, decision.model) not in avail_set:
            logger.warning(
                "Router chose %s/%s which is not in the active catalog — keeping request defaults.",
                decision.provider,
                decision.model,
            )
        else:
            prepared.actual_provider = decision.provider
            prepared.actual_model = decision.model
            prepared.router_meta = RouterMeta(
                routed=True,
                provider=decision.provider,
                model=decision.model,
                reason=decision.reason,
                estimated_cost=(
                    decision.estimated_cost.value if decision.estimated_cost else None
                ),
                confidence=decision.confidence,
                unavailable=False,
            )
            with db_connection() as conn:
                cur_rl = execute_with_retry(
                    conn,
                    """INSERT INTO routing_logs
                           (session_id, conversation_id, router_provider, router_model,
                            chosen_provider, chosen_model, routing_reason,
                            estimated_cost, confidence, router_event_id, prompt_version)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [
                        prepared.session_id,
                        prepared.conv_id,
                        prepared.router_provider,
                        prepared.router_model,
                        decision.provider,
                        decision.model,
                        decision.reason,
                        decision.estimated_cost.value if decision.estimated_cost else None,
                        decision.confidence,
                        router_event_id,
                        router_prompt_ver,
                    ],
                )
                prepared.router_log_id = cur_rl.lastrowid
            logger.info(
                "Router: routed to %s/%s (confidence=%.2f)",
                decision.provider,
                decision.model,
                decision.confidence or 0,
            )
    else:
        logger.warning(
            "Router returned unparseable output — keeping request defaults. Raw: %s",
            raw_content[:200],
        )

    prepared.timing_ms["router"] = (time.perf_counter() - t0) * 1000


def apply_web_search_phase(prepared: PreparedChatSend) -> None:
    """Inject Brave search context with a hard timeout."""
    if prepared.is_image_gen:
        return

    t0 = time.perf_counter()
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(augment_messages_with_web_search, prepared.llm_messages)
            llm_messages, used, sources = future.result(timeout=BRAVE_SEARCH_TIMEOUT_SEC)
        prepared.llm_messages = llm_messages
        prepared.web_search_used = used
        prepared.web_search_sources = sources
    except concurrent.futures.TimeoutError:
        prepared.brave_timed_out = True
        prepared.brave_skipped_reason = (
            f"Brave Search timed out after {int(BRAVE_SEARCH_TIMEOUT_SEC)}s — continuing without live results."
        )
        logger.warning("Brave web search timed out after %.0fs", BRAVE_SEARCH_TIMEOUT_SEC)
    prepared.timing_ms["web_search"] = (time.perf_counter() - t0) * 1000
