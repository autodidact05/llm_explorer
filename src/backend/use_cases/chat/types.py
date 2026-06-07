from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.brave_search_service import BraveSource
from backend.use_cases.chat_phases import RouterMeta


class ChatCancelledError(Exception):
    """Client disconnected or aborted the stream."""


@dataclass
class PreparedChatSend:
    session_id: int
    conv_id: int | None
    content: str
    llm_messages: list[dict[str, Any]]
    audit_messages: list[dict[str, Any]]
    actual_provider: str
    actual_model: str
    is_image_gen: bool
    web_search_used: bool
    web_search_sources: list[BraveSource]
    router_meta: RouterMeta
    router_log_id: int | None
    router_provider: str
    router_model: str
    router_input_cost: float
    router_output_cost: float
    router_prompt_tokens: int
    router_response_tokens: int
    router_llm_enabled: bool = False
    use_router_llm: bool | None = None
    router_llm_system_msg: str | None = None
    conversation_context: str = ""
    timing_ms: dict[str, float] = field(default_factory=dict)
    router_timed_out: bool = False
    brave_timed_out: bool = False
    brave_skipped_reason: str | None = None
    idempotency_key: str | None = None
    active_branch_id: int = 1
