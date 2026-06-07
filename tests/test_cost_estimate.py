from unittest.mock import patch

from backend.use_cases.cost_estimate import estimate_chat_cost


def test_estimate_image_intent_uses_image_model() -> None:
    with patch(
        "backend.use_cases.cost_estimate.get_model_pricing",
        return_value=(2.0, 8.0),
    ):
        out = estimate_chat_cost(
            content="Generate an image of a sunset",
            provider="openai",
            model="gpt-4o",
        )
    assert out["is_image"] is True
    assert out["provider"] == "google"
    assert out["pricing_available"] is True
    assert float(out["estimated_cost"]) > 0


def test_estimate_text_uses_selected_model() -> None:
    with patch(
        "backend.use_cases.cost_estimate.get_model_pricing",
        return_value=(1.0, 2.0),
    ):
        out = estimate_chat_cost(
            content="What is the capital of France?",
            provider="openai",
            model="gpt-4o-mini",
        )
    assert out["is_image"] is False
    assert out["model"] == "gpt-4o-mini"
