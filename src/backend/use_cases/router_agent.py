from __future__ import annotations

import json
import logging
from typing import Any

from agents import Agent
from agents.agent_output import AgentOutputSchema

from backend.async_utils import run_coroutine_sync
from backend.date_context import append_date_context, build_date_context
from backend.use_cases.agent_client import build_chat_model, run_agent_async
from backend.use_cases.routing import (
    RouterAgentOutput,
    RoutingDecision,
    build_router_prompt,
    routing_decision_from_agent_output,
)

logger = logging.getLogger(__name__)


async def _run_router_agent_async(
    *,
    provider: str,
    model: str,
    router_system: str,
    user_query: str,
    curated_models: list[dict[str, Any]],
    past_feedback: list[dict[str, Any]],
    conversation_context: str,
    router_provider: str,
    router_model: str,
    image_generation: bool = False,
    strict_schema: bool = True,
) -> dict[str, Any]:
    instructions = append_date_context(router_system)
    user_input = build_router_prompt(
        user_query=user_query,
        available_models=curated_models,
        past_feedback=past_feedback,
        conversation_context=conversation_context,
        router_provider=router_provider,
        router_model=router_model,
        image_generation=image_generation,
    )
    date_line = build_date_context()
    agent_input = [
        {"role": "system", "content": instructions},
        {"role": "user", "content": f"{date_line}\n\n{user_input}"},
    ]

    agent = Agent(
        name="Router LLM",
        instructions=instructions,
        model=build_chat_model(provider, model),
        output_type=AgentOutputSchema(RouterAgentOutput, strict_json_schema=strict_schema),
    )
    try:
        run = await run_agent_async(
            agent=agent,
            agent_input=agent_input,
            provider=provider,
            model=model,
        )
    except Exception:
        if not strict_schema:
            raise
        logger.warning("Router strict JSON schema failed; retrying with relaxed schema")
        return await _run_router_agent_async(
            provider=provider,
            model=model,
            router_system=router_system,
            user_query=user_query,
            curated_models=curated_models,
            past_feedback=past_feedback,
            conversation_context=conversation_context,
            router_provider=router_provider,
            router_model=router_model,
            image_generation=image_generation,
            strict_schema=False,
        )

    agent_output = run["final_output"]
    decision: RoutingDecision | None = None
    raw_content = ""

    if isinstance(agent_output, RouterAgentOutput):
        decision = routing_decision_from_agent_output(agent_output, curated_models)
        raw_content = agent_output.model_dump_json()
    elif agent_output is not None:
        raw_content = json.dumps(agent_output)

    return {
        "decision": decision,
        "content": raw_content,
        "prompt_tokens": run["prompt_tokens"],
        "response_tokens": run["response_tokens"],
        "input_cost": run["input_cost"],
        "output_cost": run["output_cost"],
        "time_taken": run["time_taken"],
        "http_code": run["http_code"],
        "prompt_messages": agent_input,
    }


def invoke_router_agent(
    *,
    provider: str,
    model: str,
    router_system: str,
    user_query: str,
    curated_models: list[dict[str, Any]],
    past_feedback: list[dict[str, Any]],
    conversation_context: str = "",
    router_provider: str = "",
    router_model: str = "",
    image_generation: bool = False,
) -> dict[str, Any]:
    """Run the Router LLM via the OpenAI Agents SDK with structured output."""
    return run_coroutine_sync(
        _run_router_agent_async(
            provider=provider,
            model=model,
            router_system=router_system,
            user_query=user_query,
            curated_models=curated_models,
            past_feedback=past_feedback,
            conversation_context=conversation_context,
            router_provider=router_provider,
            router_model=router_model,
            image_generation=image_generation,
        )
    )
