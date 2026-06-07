"""Persist chat outcomes after a successful model run (single DB transaction).

Writes user + assistant rows, interaction aggregates, ``usage_audit``, balance
deduction, and links ``routing_logs`` to the assistant ``message_id``.
"""

from __future__ import annotations

from typing import Any

from backend.audit_service import insert_usage_audit
from backend.brave_search_service import append_brave_attribution
from backend.credit_service import deduct_credit
from backend.db import db_connection, execute_with_retry
from backend.llm_types import LLMRunResult
from backend.repos import chat_repo
from backend.use_cases.chat.types import PreparedChatSend


def finalize_chat_send(
    prepared: PreparedChatSend,
    result: LLMRunResult | dict[str, Any],
    image_url: str | None,
) -> dict[str, Any]:
    if isinstance(result, dict):
        run = LLMRunResult.from_usage_dict(
            usage=result,
            content=str(result.get("content", "")),
            prompt_messages=prepared.audit_messages,
        )
    else:
        run = result

    session_id = prepared.session_id
    conv_id = prepared.conv_id
    router_meta = prepared.router_meta
    router_log_id = prepared.router_log_id
    actual_provider = prepared.actual_provider
    actual_model = prepared.actual_model
    is_image_gen = prepared.is_image_gen
    web_search_used = prepared.web_search_used
    web_search_sources = prepared.web_search_sources
    content = prepared.content
    audit_messages = prepared.audit_messages
    router_provider = prepared.router_provider
    router_model = prepared.router_model
    router_input_cost = prepared.router_input_cost
    router_output_cost = prepared.router_output_cost
    router_prompt_tokens = prepared.router_prompt_tokens
    router_response_tokens = prepared.router_response_tokens

    total_cost = run.total_cost
    assistant_body = run.content
    if web_search_used and web_search_sources:
        assistant_body = append_brave_attribution(assistant_body, web_search_sources)
    stored_content = f"!image:{image_url}" if image_url else assistant_body

    event_id: int
    interaction_id: int
    user_message_id: int
    assistant_message_id: int

    with db_connection() as conn:
        existing = conn.execute(
            """SELECT id FROM chat_interactions
               WHERE session_id = ? AND provider = ? AND model = ?""",
            [session_id, actual_provider, actual_model],
        ).fetchone()
        if existing:
            interaction_id = int(existing["id"])
            if router_meta.routed:
                execute_with_retry(
                    conn,
                    """
                    UPDATE chat_interactions
                    SET routed_by=?, routing_reason=?, router_estimated_cost=?, router_confidence=?
                    WHERE id=?
                    """,
                    [
                        "router_llm",
                        router_meta.reason,
                        router_meta.estimated_cost,
                        router_meta.confidence,
                        interaction_id,
                    ],
                )
        else:
            cur = execute_with_retry(
                conn,
                """INSERT INTO chat_interactions
                   (session_id, provider, model, routed_by, routing_reason,
                    router_estimated_cost, router_confidence)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                [
                    session_id,
                    actual_provider,
                    actual_model,
                    "router_llm" if router_meta.routed else None,
                    router_meta.reason,
                    router_meta.estimated_cost,
                    router_meta.confidence,
                ],
            )
            interaction_id = int(cur.lastrowid)

        branch_id = prepared.active_branch_id

        user_message_id = int(
            execute_with_retry(
                conn,
                """
                INSERT INTO chat_messages (session_id, role, content, branch_id)
                VALUES (?, ?, ?, ?)
                """,
                [session_id, "user", content, branch_id],
            ).lastrowid
        )

        assistant_message_id = int(
            execute_with_retry(
                conn,
                """
                INSERT INTO chat_messages
                    (session_id, role, content, provider, model, interaction_id, branch_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    session_id,
                    "assistant",
                    stored_content,
                    actual_provider,
                    actual_model,
                    interaction_id,
                    branch_id,
                ],
            ).lastrowid
        )

        event_id = insert_usage_audit(
            provider=actual_provider,
            model=actual_model,
            prompt_tokens=run.prompt_tokens,
            response_tokens=run.response_tokens,
            input_cost=run.input_cost,
            output_cost=run.output_cost,
            time_taken=run.time_taken,
            http_code=run.http_code,
            prompt_messages=audit_messages,
            response_content=assistant_body,
            conversation_id=conv_id,
            session_id=session_id,
            interaction_id=interaction_id,
            message_id=assistant_message_id,
            conn=conn,
        )

        execute_with_retry(
            conn,
            """
            UPDATE chat_messages
            SET event_id = ?, provider = ?, model = ?, interaction_id = ?
            WHERE id = ?
            """,
            [event_id, actual_provider, actual_model, interaction_id, assistant_message_id],
        )
        if router_log_id is not None:
            execute_with_retry(
                conn,
                "UPDATE routing_logs SET message_id = ? WHERE id = ?",
                [assistant_message_id, router_log_id],
            )

        if total_cost > 0:
            deduct_credit(
                total_cost,
                f"Chat: {actual_provider}/{actual_model}",
                conversation_id=conv_id,
                conn=conn,
            )
        router_total_cost = router_input_cost + router_output_cost
        if router_total_cost > 0:
            deduct_credit(
                router_total_cost,
                f"Router LLM: {router_provider}/{router_model}",
                conversation_id=conv_id,
                conn=conn,
            )

    response = {
        "content": assistant_body,
        "image_url": image_url,
        "is_image": is_image_gen,
        "web_search_used": web_search_used,
        "web_search_sources": web_search_sources,
        "prompt_tokens": run.prompt_tokens,
        "response_tokens": run.response_tokens,
        "input_cost": run.input_cost,
        "output_cost": run.output_cost,
        "total_cost": total_cost,
        "time_taken": run.time_taken,
        "http_code": run.http_code,
        "event_id": event_id,
        "conversation_id": conv_id,
        "session_id": session_id,
        "interaction_id": interaction_id,
        "message_id": assistant_message_id,
        "actual_provider": actual_provider,
        "actual_model": actual_model,
        "router_routed": router_meta.routed,
        "router_unavailable": router_meta.unavailable,
        "router_provider": router_meta.provider,
        "router_model": router_meta.model,
        "router_reason": router_meta.reason,
        "router_estimated_cost": router_meta.estimated_cost,
        "router_confidence": router_meta.confidence,
        "router_input_cost": router_input_cost,
        "router_output_cost": router_output_cost,
        "router_total_cost": router_total_cost,
        "router_prompt_tokens": router_prompt_tokens,
        "router_response_tokens": router_response_tokens,
        "user_message_id": user_message_id,
        "timing_ms": prepared.timing_ms,
    }

    if prepared.idempotency_key:
        chat_repo.store_idempotent_response(
            session_id,
            prepared.idempotency_key,
            response,
        )

    return response
