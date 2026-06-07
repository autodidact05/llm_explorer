"""Rough cost estimates before sending a chat message."""

from __future__ import annotations

from backend.pricing_service import get_model_pricing
from backend.use_cases.image_gen_constants import (
    IMAGE_GEN_MODEL,
    IMAGE_GEN_PROVIDER,
    detect_image_generation_intent,
)

# Typical token assumptions for pre-send estimates (not exact).
_TEXT_PROMPT_TOKENS = 800
_TEXT_RESPONSE_TOKENS = 400
_IMAGE_PROMPT_TOKENS = 200
_IMAGE_OUTPUT_UNITS = 1_000  # billed like output tokens for flat estimate


def estimate_chat_cost(
    *,
    content: str,
    provider: str,
    model: str,
) -> dict[str, float | str | bool]:
    is_image = detect_image_generation_intent(content)
    if is_image:
        est_provider = IMAGE_GEN_PROVIDER
        est_model = IMAGE_GEN_MODEL
        prompt_tokens = _IMAGE_PROMPT_TOKENS
        response_tokens = _IMAGE_OUTPUT_UNITS
    else:
        est_provider = provider
        est_model = model
        prompt_tokens = _TEXT_PROMPT_TOKENS
        response_tokens = _TEXT_RESPONSE_TOKENS

    try:
        input_per_m, output_per_m = get_model_pricing(est_provider, est_model)
    except ValueError:
        return {
            "is_image": is_image,
            "provider": est_provider,
            "model": est_model,
            "estimated_cost": 0.0,
            "prompt_tokens_est": prompt_tokens,
            "response_tokens_est": response_tokens,
            "pricing_available": False,
        }

    input_cost = (prompt_tokens / 1_000_000) * input_per_m
    output_cost = (response_tokens / 1_000_000) * output_per_m
    total = input_cost + output_cost

    return {
        "is_image": is_image,
        "provider": est_provider,
        "model": est_model,
        "estimated_cost": round(total, 8),
        "input_cost_est": round(input_cost, 8),
        "output_cost_est": round(output_cost, 8),
        "prompt_tokens_est": prompt_tokens,
        "response_tokens_est": response_tokens,
        "pricing_available": True,
    }
