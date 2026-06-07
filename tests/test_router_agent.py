from __future__ import annotations

from backend.use_cases.routing import (
    RouterAgentOutput,
    routing_decision_from_agent_output,
)


def test_routing_decision_from_agent_output() -> None:
    models = [
        {"provider": "openai", "model": "gpt-4o-mini"},
        {"provider": "anthropic", "model": "claude-3-haiku"},
    ]
    output = RouterAgentOutput(
        model_index=1,
        reason="Better for analysis",
        estimated_cost="low",
        confidence=1.2,
    )
    decision = routing_decision_from_agent_output(output, models)
    assert decision is not None
    assert decision.provider == "anthropic"
    assert decision.model == "claude-3-haiku"
    assert decision.confidence == 1.0


def test_routing_decision_from_agent_output_invalid_index() -> None:
    output = RouterAgentOutput(model_index=99, reason="nope")
    assert routing_decision_from_agent_output(output, []) is None
