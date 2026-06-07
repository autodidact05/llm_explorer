"""Low-level OpenAI-compatible clients: Agents SDK runs and streaming completions.

Provider routing (OpenRouter, Ollama, Groq) and cost calculation live here;
higher-level agents (``answering_agent``, ``router_agent``) build prompts and
call into this module.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx
from agents import Agent, AsyncOpenAI, OpenAIChatCompletionsModel, Runner, set_tracing_disabled
from openai import OpenAIError

import backend.config as _config
from backend.chat_timeouts import (
    ANSWERING_TIMEOUT_SEC,
    HTTP_CONNECT_TIMEOUT_SEC,
    TTFT_TIMEOUT_SEC,
)
from backend.image_service import reset_client as reset_image_client
from backend.llm_common import LLMCallError, calculate_cost, get_provider_api_key
from backend.pricing_service import get_model_pricing

logger = logging.getLogger(__name__)

_tracing_disabled = False
_async_client_cache: dict[str, AsyncOpenAI] = {}


def _http_timeout() -> httpx.Timeout:
    return httpx.Timeout(ANSWERING_TIMEOUT_SEC, connect=HTTP_CONNECT_TIMEOUT_SEC)


def ensure_tracing_disabled() -> None:
    global _tracing_disabled
    if not _tracing_disabled:
        set_tracing_disabled(True)
        _tracing_disabled = True


def reset_agent_clients() -> None:
    """Clear cached OpenAI clients after API key changes."""
    _async_client_cache.clear()
    reset_image_client()


def get_async_client(provider: str) -> AsyncOpenAI:
    if provider == "ollama":
        cache_key = "ollama"
        if cache_key not in _async_client_cache:
            _async_client_cache[cache_key] = AsyncOpenAI(
                base_url=_config.OLLAMA_BASE_URL,
                api_key="ollama",
                timeout=_http_timeout(),
            )
        return _async_client_cache[cache_key]

    resolved = provider if provider == "groq" else "openrouter"
    cache_key = resolved
    if cache_key not in _async_client_cache:
        api_key = get_provider_api_key(resolved)
        base_url = _config.GROQ_BASE_URL if resolved == "groq" else _config.OPENROUTER_BASE_URL
        _async_client_cache[cache_key] = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=_http_timeout(),
        )
    return _async_client_cache[cache_key]


def model_id(provider: str, model: str) -> str:
    if provider in ("ollama", "groq"):
        return model
    return f"{provider}/{model}"


def build_chat_model(provider: str, model: str) -> OpenAIChatCompletionsModel:
    return OpenAIChatCompletionsModel(
        model=model_id(provider, model),
        openai_client=get_async_client(provider),
    )


def split_system_and_conversation(
    messages: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """Separate system instructions from turn history for Agent + Runner."""
    system_parts: list[str] = []
    conversation: list[dict[str, Any]] = []
    for msg in messages:
        role = str(msg.get("role") or "")
        if role == "system":
            content = msg.get("content")
            if isinstance(content, str):
                system_parts.append(content)
            else:
                system_parts.append(str(content))
        else:
            conversation.append(msg)
    return "\n\n".join(system_parts), conversation


def prepare_agent_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build Chat Completions input with date context visible to all providers.

    Some OpenRouter-backed models ignore Agent instructions / system role. We
    therefore send an explicit system message *and* prefix the latest user turn
    with the current date so relative date questions resolve correctly.
    """
    from backend.date_context import append_date_context, build_date_context
    from backend.response_quality import append_response_quality

    instructions, conversation = split_system_and_conversation(messages)
    system_content = append_response_quality(append_date_context(instructions or None))
    date_line = build_date_context()

    agent_input: list[dict[str, Any]] = [{"role": "system", "content": system_content}]

    if not conversation:
        return agent_input

    for index, msg in enumerate(conversation):
        is_latest_user = index == len(conversation) - 1 and msg.get("role") == "user"
        if not is_latest_user:
            agent_input.append(msg)
            continue

        content = msg.get("content")
        if isinstance(content, str):
            prefixed = content if date_line in content else f"{date_line}\n\n{content}"
            agent_input.append({"role": "user", "content": prefixed})
            continue

        if isinstance(content, list):
            parts = list(content)
            if not any(
                isinstance(part, dict) and date_line in str(part.get("text") or "")
                for part in parts
            ):
                parts.insert(0, {"type": "text", "text": date_line})
            agent_input.append({"role": "user", "content": parts})
            continue

        agent_input.append(msg)

    return agent_input


def _delta_text(delta: object) -> str:
    """Extract user-visible text from a streaming delta; ignore chain-of-thought fields."""
    reasoning = getattr(delta, "reasoning", None) or getattr(delta, "reasoning_content", None)
    if reasoning:
        # Never stream hidden reasoning tokens into the chat UI.
        pass

    content = getattr(delta, "content", None)
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict):
                if part.get("type") in ("text", "output_text"):
                    parts.append(str(part.get("text") or ""))
            else:
                part_type = getattr(part, "type", None)
                if part_type in ("text", "output_text"):
                    parts.append(str(getattr(part, "text", "") or ""))
        return "".join(parts)
    return str(content)


def usage_costs(
    provider: str,
    model: str,
    prompt_tokens: int,
    response_tokens: int,
) -> tuple[float, float]:
    if provider == "ollama":
        return 0.0, 0.0
    input_per_million, output_per_million = get_model_pricing(provider, model)
    return (
        calculate_cost(prompt_tokens, input_per_million),
        calculate_cost(response_tokens, output_per_million),
    )


async def stream_chat_completions(
    *,
    provider: str,
    model: str,
    messages: list[dict[str, Any]],
) -> AsyncIterator[str | dict[str, Any]]:
    """Yield text deltas, then a final ``{"_usage": true, ...}`` dict."""
    client = get_async_client(provider)
    mid = model_id(provider, model)

    t0 = time.perf_counter()
    try:
        stream = await client.chat.completions.create(
            model=mid,
            messages=messages,  # type: ignore[arg-type]
            stream=True,
            stream_options={"include_usage": True},
        )
    except OpenAIError as exc:
        time_taken = time.perf_counter() - t0
        http_code = int(getattr(exc, "status_code", 500))
        raise LLMCallError(str(exc), http_code, time_taken) from exc

    prompt_tokens = 0
    response_tokens = 0
    aiter = stream.__aiter__()
    awaiting_first_token = True
    while True:
        chunk_timeout = TTFT_TIMEOUT_SEC if awaiting_first_token else ANSWERING_TIMEOUT_SEC
        try:
            chunk = await asyncio.wait_for(aiter.__anext__(), timeout=chunk_timeout)
        except StopAsyncIteration:
            break
        except asyncio.TimeoutError:
            time_taken = time.perf_counter() - t0
            if awaiting_first_token:
                raise LLMCallError(
                    f"Timed out waiting for first token after {int(TTFT_TIMEOUT_SEC)}s",
                    504,
                    time_taken,
                ) from None
            raise LLMCallError(
                f"Timed out during streaming after {int(ANSWERING_TIMEOUT_SEC)}s",
                504,
                time_taken,
            ) from None

        if chunk.usage is not None:
            prompt_tokens = int(chunk.usage.prompt_tokens or 0)
            response_tokens = int(chunk.usage.completion_tokens or 0)
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        text = _delta_text(delta)
        if text:
            awaiting_first_token = False
            yield text

    time_taken = time.perf_counter() - t0
    input_cost, output_cost = usage_costs(provider, model, prompt_tokens, response_tokens)
    yield {
        "_usage": True,
        "prompt_tokens": prompt_tokens,
        "response_tokens": response_tokens,
        "input_cost": input_cost,
        "output_cost": output_cost,
        "time_taken": time_taken,
        "http_code": 200,
    }


async def run_agent_async(
    *,
    agent: Agent[Any],
    agent_input: str | list[Any],
    provider: str,
    model: str,
) -> dict[str, Any]:
    """Execute an Agents SDK agent and return normalized usage metadata."""
    ensure_tracing_disabled()

    t0 = time.perf_counter()
    try:
        result = await Runner.run(agent, agent_input)
    except OpenAIError as exc:
        time_taken = time.perf_counter() - t0
        http_code = int(getattr(exc, "status_code", 500))
        raise LLMCallError(str(exc), http_code, time_taken) from exc
    time_taken = time.perf_counter() - t0

    usage = result.context_wrapper.usage
    prompt_tokens = int(usage.input_tokens)
    response_tokens = int(usage.output_tokens)
    input_cost, output_cost = usage_costs(provider, model, prompt_tokens, response_tokens)

    return {
        "final_output": result.final_output,
        "prompt_tokens": prompt_tokens,
        "response_tokens": response_tokens,
        "input_cost": input_cost,
        "output_cost": output_cost,
        "time_taken": time_taken,
        "http_code": 200,
    }
