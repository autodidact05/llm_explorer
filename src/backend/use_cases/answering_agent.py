from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from agents import Agent

from backend.async_utils import run_coroutine_sync
from backend.brave_search_service import (
    append_web_search_note,
    augment_messages_with_web_search,
    is_brave_configured,
)
from backend.date_context import append_date_context
from backend.llm_types import LLMRunResult
from backend.use_cases.agent_client import (
    build_chat_model,
    prepare_agent_messages,
    run_agent_async,
    split_system_and_conversation,
    stream_chat_completions,
)

logger = logging.getLogger(__name__)


async def _run_answering_agent_async(
    *,
    provider: str,
    model: str,
    messages: list[dict[str, Any]],
) -> LLMRunResult:
    agent_input = prepare_agent_messages(messages)
    if not any(msg.get("role") == "user" for msg in agent_input):
        raise ValueError("Answering agent requires at least one user message.")

    instructions, _conversation = split_system_and_conversation(agent_input)
    agent = Agent(
        name="Answering LLM",
        instructions=instructions or "Follow the system and user messages.",
        model=build_chat_model(provider, model),
    )
    run = await run_agent_async(
        agent=agent,
        agent_input=agent_input,
        provider=provider,
        model=model,
    )
    result = LLMRunResult.from_agent_run(run=run, prompt_messages=agent_input)

    logger.info(
        "%s/%s — %d prompt + %d completion tokens — $%.8f total — %.2fs",
        provider,
        model,
        result.prompt_tokens,
        result.response_tokens,
        result.total_cost,
        result.time_taken,
    )
    return result


def invoke_answering_agent(
    *,
    provider: str,
    model: str,
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    """Run the Answering LLM via the OpenAI Agents SDK."""
    result = run_coroutine_sync(
        _run_answering_agent_async(provider=provider, model=model, messages=messages)
    )
    return result.to_dict()


async def stream_answering_agent(
    *,
    provider: str,
    model: str,
    messages: list[dict[str, Any]],
) -> AsyncIterator[str | dict[str, Any]]:
    """Stream answering LLM tokens, then a final usage dict (``_usage`` key)."""
    agent_input = prepare_agent_messages(messages)
    if not any(msg.get("role") == "user" for msg in agent_input):
        raise ValueError("Answering agent requires at least one user message.")

    async for part in stream_chat_completions(
        provider=provider,
        model=model,
        messages=agent_input,
    ):
        yield part


def invoke_prompt(*, provider: str, model: str, prompt: str) -> dict[str, Any]:
    """Single-turn Answering LLM call with date-aware system context."""
    system_content = append_date_context(None)
    if is_brave_configured():
        system_content = append_web_search_note(system_content)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": prompt},
    ]
    messages, _web_used, _sources = augment_messages_with_web_search(messages)
    return invoke_answering_agent(provider=provider, model=model, messages=messages)
