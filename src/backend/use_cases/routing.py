from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator

# ── EstimatedCost / RoutingDecision ───────────────────────────────────────────

class EstimatedCost(StrEnum):
    free = "free"
    low = "low"
    medium = "medium"
    high = "high"
    expensive = "expensive"


class RoutingDecision(BaseModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    reason: str | None = None
    estimated_cost: EstimatedCost | None = None
    confidence: float | None = None

    @field_validator("provider", "model")
    @classmethod
    def _strip_non_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must be non-empty")
        return v

    @field_validator("confidence")
    @classmethod
    def _clamp_confidence(cls, v: float | None) -> float | None:
        if v is None:
            return None
        return max(0.0, min(1.0, v))


class RouterAgentOutput(BaseModel):
    """Structured output schema for the Router LLM agent."""

    model_index: int = Field(ge=0)
    reason: str | None = None
    estimated_cost: EstimatedCost | None = None
    confidence: float | None = None

    @field_validator("confidence")
    @classmethod
    def _clamp_confidence(cls, v: float | None) -> float | None:
        if v is None:
            return None
        return max(0.0, min(1.0, v))


def routing_decision_from_agent_output(
    output: RouterAgentOutput,
    indexed_models: list[dict[str, Any]],
) -> RoutingDecision | None:
    """Map a structured router agent response to a catalog-backed routing decision."""
    if output.model_index < 0 or output.model_index >= len(indexed_models):
        return None
    chosen = indexed_models[output.model_index]
    try:
        return RoutingDecision.model_validate({
            "provider": chosen["provider"],
            "model": chosen["model"],
            "reason": str(output.reason or "").strip() or None,
            "estimated_cost": output.estimated_cost,
            "confidence": output.confidence,
        })
    except ValidationError:
        return None


# ── Catalog curation ──────────────────────────────────────────────────────────

def _model_text(m: dict[str, Any]) -> str:
    return " ".join([
        m.get("provider") or "",
        m.get("model") or "",
        m.get("category") or "",
        m.get("description") or "",
    ]).lower()


_IMAGE_GEN_KEYWORDS = (
    "flash-image",
    "image-preview",
    "flux",
    "riverflow",
    "recraft",
    "dall-e",
    "imagen",
    "stable-diffusion",
    "ideogram",
    "gpt-image",
)


def is_image_generation_model(provider: str, model: str) -> bool:
    """True when the catalog entry is an image-output model (OpenRouter image gen)."""
    text = f"{provider}/{model}".lower()
    if "image" in (model or "").lower():
        return True
    return any(kw in text for kw in _IMAGE_GEN_KEYWORDS)


def curate_models_for_image_routing(
    models: list[dict[str, Any]],
    *,
    past_providers_models: set[tuple[str, str]] | None = None,
    max_total: int = 20,
) -> list[dict[str, Any]]:
    """Subset of the catalog limited to image-generation models for the router."""
    image_models = [
        m for m in models
        if is_image_generation_model(str(m.get("provider") or ""), str(m.get("model") or ""))
    ]
    if not image_models:
        return []
    return curate_models_for_routing(
        image_models,
        past_providers_models=past_providers_models,
        max_total=max_total,
    )


def curate_models_for_routing(
    models: list[dict[str, Any]],
    *,
    past_providers_models: set[tuple[str, str]] | None = None,
    max_total: int = 40,
) -> list[dict[str, Any]]:
    """Return a representative, tiered subset of the full model catalog.

    The router only sees this curated list, so it can make informed trade-offs
    without being overwhelmed by hundreds of entries or biased to the cheapest.

    Selection strategy (priority order, deduplicated):
      1. Models from past routing feedback (always keep — they have quality signal)
      2. Reasoning / thinking models (for complex analytical tasks)
      3. Multimodal / vision models (for image-bearing messages)
      4. Code-specialist models (for coding tasks)
      5. Long-context models with ≥200k context window
      6. Tiered price sampling — a few models from cheap / mid / premium bands
         so the router can balance quality against cost for any task
    """
    seen: set[tuple[str, str]] = set()
    result: list[dict[str, Any]] = []

    def _add(m: dict[str, Any]) -> bool:
        key = (m["provider"], m["model"])
        if key not in seen and len(result) < max_total:
            seen.add(key)
            result.append(m)
            return True
        return False

    sorted_by_price = sorted(
        models, key=lambda m: float(m.get("input_per_million") or 999)
    )

    # 1. Past-feedback models — always include for continuity
    if past_providers_models:
        for m in sorted_by_price:
            if (m["provider"], m["model"]) in past_providers_models:
                _add(m)

    # 2. Reasoning / thinking models
    reasoning_kw = ["reasoning", "thinking", "think", ":r1", "-r1", ":r2", "-r2",
                    "qwq", "o1", "o3", "deepseek-r", "r1-"]
    for m in sorted_by_price:
        if any(kw in _model_text(m) for kw in reasoning_kw):
            _add(m)

    # 3. Multimodal / vision models
    vision_kw = ["multimodal", "vision", "visual"]
    for m in sorted_by_price:
        if any(kw in _model_text(m) for kw in vision_kw):
            _add(m)

    # 4. Code-specialist models
    code_kw = ["codestral", "starcoder", "devstral", "qwen-coder", "deepseek-coder"]
    for m in sorted_by_price:
        if any(kw in _model_text(m) for kw in code_kw):
            _add(m)

    # 5. Long-context models (≥200k tokens)
    for m in sorted(models, key=lambda m: -int(m.get("context_length") or 0)):
        if int(m.get("context_length") or 0) >= 200_000:
            _add(m)

    # 6. Tiered price sampling — fill remaining slots with cheap / mid / premium
    n = len(sorted_by_price)
    if n > 0:
        # Divide into 4 price bands and take up to 4 models per band
        band = max(1, n // 4)
        for band_start in range(0, n, band):
            for m in sorted_by_price[band_start: band_start + band][:4]:
                _add(m)
            if len(result) >= max_total:
                break

    return result[:max_total]


# ── Single-pass indexed prompt ─────────────────────────────────────────────────

def build_router_prompt(
    *,
    user_query: str,
    available_models: list[dict[str, Any]],
    past_feedback: list[dict[str, Any]],
    conversation_context: str = "",
    router_provider: str = "",
    router_model: str = "",
    image_generation: bool = False,
) -> str:
    """Build the single-pass routing prompt with an indexed model list.

    The router returns ``model_index`` (an integer) rather than a provider/model
    string, which prevents hallucinated model IDs — the caller looks up the real
    model by index after parsing.
    """
    model_lines: list[str] = []
    for i, m in enumerate(available_models):
        ctx = f" ctx:{m['context_length']}" if m.get("context_length") else ""
        model_lines.append(
            f"[{i}] {m['provider']}/{m['model']} [{m.get('category') or 'text'}] "
            f"in:${float(m['input_per_million']):.4f}/out:${float(m['output_per_million']):.4f} per 1M tokens"
            f"{ctx}"
        )

    past_lines: list[str] = []
    for r in past_feedback:
        rating = int(r.get("rating") or 0)
        label = {1: "NOT ACCEPTABLE", 2: "OKAY", 3: "EXCELLENT"}.get(rating, "?")
        note = f" (note: {r.get('comment')})" if r.get("comment") else ""
        past_lines.append(
            f"[{label}] {r.get('provider')}/{r.get('model')}: "
            f"'{r.get('routing_reason') or ''}'{note}"
        )
    past_block = (
        "\n\nPast routing feedback (use to improve decisions):\n" + "\n".join(past_lines)
    ) if past_lines else ""

    context_block = (
        f"\n\nRecent conversation context (use to understand follow-up questions):\n"
        f"{conversation_context}"
    ) if conversation_context.strip() else ""

    self_note = ""
    if router_provider and router_model:
        self_note = (
            f"\n\nCRITICAL: You are {router_provider}/{router_model}. "
            f"Do NOT pick index of yourself or any other {router_provider} model out of bias. "
            f"Be strictly provider-neutral — pick the model that is genuinely best for the task."
        )

    n = len(available_models)
    if image_generation:
        task_block = (
            f"User message (image generation): {user_query[:1000]}\n\n"
            f"The user wants a new image generated. Every model in the list can output images.\n"
            f"Select the single best image-generation model. Balance:\n"
            f"  1. Visual quality and style fit for the prompt\n"
            f"  2. Cost efficiency\n"
            f"  3. Speed / latency\n"
            f"\nReturn model_index in the range 0–{n - 1}."
        )
    else:
        task_block = (
            f"User message: {user_query[:1000]}\n\n"
            f"Analyze the request and select the single best model. Balance:\n"
            f"  1. Task fit & response quality\n"
            f"  2. Reasoning / coding / multimodal requirements\n"
            f"  3. Cost efficiency — don't overspend on simple tasks\n"
            f"  4. Speed / latency for the task\n"
            f"\nReturn model_index in the range 0–{n - 1}."
        )

    return (
        f"Available models (select by index 0–{n - 1}):\n"
        + "\n".join(model_lines)
        + f"{context_block}"
        + f"{self_note}"
        + f"{past_block}\n\n"
        + task_block
    )
