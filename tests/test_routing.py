from __future__ import annotations

from backend.use_cases.routing import build_router_prompt


def test_build_router_prompt_uses_structured_index_instruction() -> None:
    prompt = build_router_prompt(
        user_query="Explain quantum computing",
        available_models=[
            {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "category": "text",
                "input_per_million": 0.15,
                "output_per_million": 0.6,
            }
        ],
        past_feedback=[],
    )
    assert "Return model_index in the range 0–0." in prompt
    assert "Reply ONLY with JSON" not in prompt
