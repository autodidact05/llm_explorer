"""Non-streaming chat send: same pipeline as stream without token events."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from backend.audit_service import insert_usage_audit
from backend.llm_common import LLMCallError
from backend.repos import chat_repo
from backend.use_cases.chat.execute import execute_chat_model
from backend.use_cases.chat.finalize import finalize_chat_send
from backend.use_cases.chat.prepare import prepare_chat_send


def send_message(
    *,
    session_id: int,
    provider: str,
    model: str,
    content: str,
    attachments: list[dict[str, Any]] | None,
    use_router_llm: bool | None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    if idempotency_key:
        cached = chat_repo.get_idempotent_response(session_id, idempotency_key)
        if cached is not None:
            return cached

    prepared = prepare_chat_send(
        session_id=session_id,
        provider=provider,
        model=model,
        content=content,
        attachments=attachments,
        use_router_llm=use_router_llm,
        idempotency_key=idempotency_key,
    )
    try:
        result, image_url = execute_chat_model(prepared)
    except LLMCallError as exc:
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
        raise HTTPException(exc.http_code, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc

    return finalize_chat_send(prepared, result, image_url)
