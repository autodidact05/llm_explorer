"""Build the message list and metadata before router / search / answering run.

``prepare_chat_context`` loads history, merges system prompts (conversation → app
default → date + quality + Brave notes), saves attachments, and detects image-gen
intent. ``prepare_chat_send`` runs the same then applies router, Brave, and image
model phases (used by the non-streaming path).
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import HTTPException

from backend.brave_search_service import append_web_search_note, is_brave_configured
from backend.date_context import append_date_context
from backend.response_quality import append_response_quality
from backend.repos import chat_repo
from backend.repos.settings_keys import SettingsKey
from backend.repos.settings_repo import get_settings
from backend.use_cases.chat.attachments import build_user_message, save_attachments
from backend.use_cases.chat.types import PreparedChatSend
from backend.use_cases.chat_phases import (
    RouterMeta,
    apply_image_model_defaults,
    apply_router_phase,
    apply_web_search_phase,
)
from backend.use_cases.context_window import trim_message_history
from backend.use_cases.image_gen_constants import detect_image_generation_intent
from backend.use_cases.groq_models import assert_groq_model_allowed
from backend.use_cases.routing_defaults import DEFAULT_ROUTER_MODEL, DEFAULT_ROUTER_PROVIDER


def prepare_chat_context(
    *,
    session_id: int,
    provider: str,
    model: str,
    content: str,
    attachments: list[dict[str, Any]] | None,
    use_router_llm: bool | None,
    idempotency_key: str | None = None,
) -> PreparedChatSend:
    assert_groq_model_allowed(provider=provider, model=model)

    t0 = time.perf_counter()
    session = chat_repo.get_session_for_send(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session["status"] != "active":
        raise HTTPException(400, "Session is not active")

    conv_id = session["conversation_id"]
    active_branch_id = int(session["active_branch_id"] or 1)
    history_rows = chat_repo.load_conversation_history(
        conv_id=conv_id,
        session_id=session_id,
        active_branch_id=active_branch_id,
    )
    history = trim_message_history([dict(r) for r in history_rows])

    conv_system_msg = chat_repo.get_conversation_system_message(conv_id)
    settings_map = get_settings(
        [
            SettingsKey.GENERIC_SYSTEM_MESSAGE,
            SettingsKey.ROUTER_LLM_ENABLED,
            SettingsKey.ROUTER_LLM_SYSTEM_MESSAGE,
            SettingsKey.ROUTER_LLM_PROVIDER,
            SettingsKey.ROUTER_LLM_MODEL,
        ]
    )
    generic_system_msg: str | None = settings_map.get(SettingsKey.GENERIC_SYSTEM_MESSAGE) or None
    router_llm_enabled = settings_map.get(SettingsKey.ROUTER_LLM_ENABLED) == "1"
    router_llm_system_msg: str | None = (
        settings_map.get(SettingsKey.ROUTER_LLM_SYSTEM_MESSAGE) or None
    )
    router_provider = settings_map.get(SettingsKey.ROUTER_LLM_PROVIDER) or DEFAULT_ROUTER_PROVIDER
    router_model = settings_map.get(SettingsKey.ROUTER_LLM_MODEL) or DEFAULT_ROUTER_MODEL

    active_system_msg = conv_system_msg or generic_system_msg
    system_content = append_response_quality(append_date_context(active_system_msg))
    if is_brave_configured():
        system_content = append_web_search_note(system_content)

    llm_messages: list[dict[str, Any]] = [{"role": "system", "content": system_content}]
    llm_messages += [{"role": r["role"], "content": r["content"]} for r in history]

    if attachments:
        save_attachments(session_id=session_id, attachments=attachments)

    llm_messages.append(build_user_message(content=content, attachments=attachments))

    audit_messages = [{"role": r["role"], "content": r["content"]} for r in history]
    audit_messages.append({"role": "user", "content": content})

    is_image_gen = detect_image_generation_intent(content)

    recent_history = history[-10:] if len(history) > 10 else history
    conversation_context = "\n".join(
        f"[{r['role']}]: {str(r['content'])[:300]}" for r in recent_history
    )

    timing_ms = {"context": (time.perf_counter() - t0) * 1000}

    return PreparedChatSend(
        session_id=session_id,
        conv_id=conv_id,
        content=content,
        llm_messages=llm_messages,
        audit_messages=audit_messages,
        actual_provider=provider,
        actual_model=model,
        is_image_gen=is_image_gen,
        web_search_used=False,
        web_search_sources=[],
        router_meta=RouterMeta(routed=False),
        router_log_id=None,
        router_provider=router_provider,
        router_model=router_model,
        router_input_cost=0.0,
        router_output_cost=0.0,
        router_prompt_tokens=0,
        router_response_tokens=0,
        router_llm_enabled=router_llm_enabled,
        use_router_llm=use_router_llm,
        router_llm_system_msg=router_llm_system_msg,
        conversation_context=conversation_context,
        timing_ms=timing_ms,
        idempotency_key=idempotency_key,
        active_branch_id=active_branch_id,
    )


def prepare_chat_send(
    *,
    session_id: int,
    provider: str,
    model: str,
    content: str,
    attachments: list[dict[str, Any]] | None,
    use_router_llm: bool | None,
    idempotency_key: str | None = None,
) -> PreparedChatSend:
    prepared = prepare_chat_context(
        session_id=session_id,
        provider=provider,
        model=model,
        content=content,
        attachments=attachments,
        use_router_llm=use_router_llm,
        idempotency_key=idempotency_key,
    )
    apply_router_phase(prepared)
    apply_web_search_phase(prepared)
    apply_image_model_defaults(prepared)
    return prepared
