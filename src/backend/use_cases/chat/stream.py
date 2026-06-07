"""SSE streaming path for chat: prepare → router → Brave → answer → finalize.

Yields typed events (``stage``, ``token``, ``meta``, ``done``, ``error``) consumed
by ``http/routers/chat.py``. Timeouts and partial progress are surfaced to the UI
via ``chat_timeouts`` thresholds and ``ChatCancelledError`` on client disconnect.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from backend.audit_service import insert_usage_audit
from backend.brave_search_service import append_brave_attribution
from backend.chat_timeouts import (
    ANSWERING_TIMEOUT_SEC,
    HARD_WARN_ELAPSED_SEC,
    IMAGE_GENERATION_TIMEOUT_SEC,
    ROUTER_TIMEOUT_SEC,
    SOFT_WARN_ELAPSED_SEC,
)
from backend.llm_common import LLMCallError
from backend.llm_types import LLMRunResult
from backend.use_cases.answering_agent import stream_answering_agent
from backend.use_cases.chat.execute import execute_image_sync
from backend.use_cases.chat.finalize import finalize_chat_send
from backend.use_cases.chat.prepare import prepare_chat_context
from backend.use_cases.chat.types import ChatCancelledError, PreparedChatSend
from backend.use_cases.chat_phases import (
    apply_image_model_defaults,
    apply_router_phase,
    apply_web_search_phase,
)

logger = logging.getLogger(__name__)


def _stream_meta_event(prepared: PreparedChatSend) -> dict[str, Any]:
    router_total = prepared.router_input_cost + prepared.router_output_cost
    return {
        "type": "meta",
        "actual_provider": prepared.actual_provider,
        "actual_model": prepared.actual_model,
        "is_image": prepared.is_image_gen,
        "web_search_used": prepared.web_search_used,
        "web_search_sources": prepared.web_search_sources,
        "router_routed": prepared.router_meta.routed,
        "router_unavailable": prepared.router_meta.unavailable,
        "router_timed_out": prepared.router_timed_out,
        "brave_timed_out": prepared.brave_timed_out,
        "router_provider": prepared.router_meta.provider,
        "router_model": prepared.router_meta.model,
        "router_reason": prepared.router_meta.reason,
        "router_estimated_cost": prepared.router_meta.estimated_cost,
        "router_confidence": prepared.router_meta.confidence,
        "router_input_cost": prepared.router_input_cost,
        "router_output_cost": prepared.router_output_cost,
        "router_total_cost": router_total,
        "router_prompt_tokens": prepared.router_prompt_tokens,
        "router_response_tokens": prepared.router_response_tokens,
        "timing_ms": prepared.timing_ms,
        "soft_warn_elapsed_sec": SOFT_WARN_ELAPSED_SEC,
        "hard_warn_elapsed_sec": HARD_WARN_ELAPSED_SEC,
    }


def _stream_error_event(
    exc: Exception,
    *,
    stage: str | None = None,
    http_code: int = 500,
    time_taken: float = 0.0,
) -> dict[str, Any]:
    return {
        "type": "error",
        "message": str(exc),
        "http_code": http_code,
        "stage": stage,
        "time_taken": time_taken,
    }


async def _run_with_timeout(
    fn: Callable[[], tuple[LLMRunResult, str | None]],
    *,
    timeout_sec: float,
    stage: str,
) -> tuple[LLMRunResult, str | None]:
    try:
        return await asyncio.wait_for(asyncio.to_thread(fn), timeout=timeout_sec)
    except asyncio.TimeoutError as exc:
        raise LLMCallError(
            f"{stage} timed out after {int(timeout_sec)}s",
            504,
            timeout_sec,
        ) from exc


async def iter_send_message_stream(
    *,
    session_id: int,
    provider: str,
    model: str,
    content: str,
    attachments: list[dict[str, Any]] | None,
    use_router_llm: bool | None,
    idempotency_key: str | None = None,
    is_disconnected: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    send_started = time.perf_counter()
    prepared: PreparedChatSend | None = None
    active_stage = "preparing"
    parts: list[str] = []

    async def check_cancel() -> None:
        if is_disconnected and await is_disconnected():
            raise ChatCancelledError()

    try:
        yield {"type": "stage", "stage": "preparing", "message": "Preparing conversation…"}
        await check_cancel()
        prepared = await asyncio.to_thread(
            prepare_chat_context,
            session_id=session_id,
            provider=provider,
            model=model,
            content=content,
            attachments=attachments,
            use_router_llm=use_router_llm,
            idempotency_key=idempotency_key,
        )

        if prepared.router_llm_enabled and prepared.use_router_llm is not False:
            active_stage = "routing"
            yield {"type": "stage", "stage": "routing", "message": "Selecting model…"}
            await check_cancel()
            await asyncio.to_thread(apply_router_phase, prepared)
            if prepared.router_timed_out:
                yield {
                    "type": "warn",
                    "level": "soft",
                    "message": (
                        f"Router timed out after {int(ROUTER_TIMEOUT_SEC)}s "
                        "— using your selected model."
                    ),
                }

        if not prepared.is_image_gen:
            active_stage = "web_search"
            yield {"type": "stage", "stage": "web_search", "message": "Searching the web…"}
            await check_cancel()
            await asyncio.to_thread(apply_web_search_phase, prepared)
            if prepared.brave_skipped_reason:
                yield {"type": "warn", "level": "soft", "message": prepared.brave_skipped_reason}

        await asyncio.to_thread(apply_image_model_defaults, prepared)
        prepared.timing_ms["prepare_total"] = (time.perf_counter() - send_started) * 1000

        yield _stream_meta_event(prepared)
        await check_cancel()

        if prepared.is_image_gen:
            active_stage = "image"
            yield {"type": "stage", "stage": "image", "message": "Generating image…"}
            gen_started = time.perf_counter()
            prep = prepared
            result, image_url = await _run_with_timeout(
                lambda: execute_image_sync(prep),
                timeout_sec=IMAGE_GENERATION_TIMEOUT_SEC,
                stage="Image generation",
            )
            prepared.timing_ms["answering"] = (time.perf_counter() - gen_started) * 1000
            response = finalize_chat_send(prepared, result, image_url)
            yield {"type": "done", "result": response}
            return

        active_stage = "generating"
        yield {"type": "stage", "stage": "generating", "message": "Generating response…"}
        usage: dict[str, Any] = {}
        answer_started = time.perf_counter()
        first_token_at: float | None = None

        async with asyncio.timeout(ANSWERING_TIMEOUT_SEC):
            async for part in stream_answering_agent(
                provider=prepared.actual_provider,
                model=prepared.actual_model,
                messages=prepared.llm_messages,
            ):
                await check_cancel()
                if isinstance(part, str):
                    if first_token_at is None:
                        first_token_at = time.perf_counter()
                        prepared.timing_ms["ttft"] = (first_token_at - answer_started) * 1000
                    parts.append(part)
                    yield {"type": "token", "delta": part}
                elif isinstance(part, dict) and part.get("_usage"):
                    usage = part

        prepared.timing_ms["answering"] = (time.perf_counter() - answer_started) * 1000
        prepared.timing_ms["total"] = (time.perf_counter() - send_started) * 1000

        full_content = "".join(parts)
        if prepared.web_search_used and prepared.web_search_sources:
            full_content = append_brave_attribution(full_content, prepared.web_search_sources)
        run = LLMRunResult.from_usage_dict(
            usage=usage,
            content=full_content,
            prompt_messages=prepared.audit_messages,
        )
        response = finalize_chat_send(prepared, run, None)
        yield {"type": "done", "result": response}
    except ChatCancelledError:
        logger.info("Chat stream cancelled session=%s stage=%s", session_id, active_stage)
        yield {
            "type": "cancelled",
            "stage": active_stage,
            "partial": bool(parts),
            "message": "Request cancelled.",
        }
    except LLMCallError as exc:
        if prepared is not None:
            insert_usage_audit(
                provider=prepared.actual_provider,
                model=prepared.actual_model,
                prompt_tokens=0,
                response_tokens=0,
                input_cost=0.0,
                output_cost=0.0,
                time_taken=exc.time_taken,
                http_code=exc.http_code,
                prompt_messages=prepared.audit_messages,
                response_content=f"ERROR: {exc}",
                write_log=False,
                conversation_id=prepared.conv_id,
                session_id=prepared.session_id,
            )
        yield _stream_error_event(
            exc, stage=active_stage, http_code=exc.http_code, time_taken=exc.time_taken
        )
    except TimeoutError as exc:
        yield _stream_error_event(exc, stage=active_stage, http_code=504)
    except Exception as exc:
        logger.exception("Chat stream failed session=%s", session_id)
        yield _stream_error_event(exc, stage=active_stage, http_code=500)
