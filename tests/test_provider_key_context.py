from backend.use_cases.provider_key_context import (
    ROUTING_MISCONFIGURED,
    ROUTING_OPENROUTER,
    _guide_for,
    _sample_models,
)


def test_guide_openai_key_warns_misconfigured() -> None:
    guide = _guide_for("openai", ROUTING_MISCONFIGURED)
    assert guide.get("misconfigured") is True
    assert "OpenRouter" in guide["summary"]


def test_guide_groq() -> None:
    guide = _guide_for("groq", "groq")
    assert guide["models_filter"] == "groq"
    assert "llama-3.1-8b-instant" in guide["summary"]
    assert "openai/gpt-oss-20b" in guide["summary"]


def test_guide_openrouter() -> None:
    guide = _guide_for("openrouter", ROUTING_OPENROUTER)
    assert guide.get("misconfigured") is not True


def test_sample_models_mixes_providers() -> None:
    samples = _sample_models(limit=8)
    providers = {s["provider"] for s in samples}
    assert "amazon" in providers
    assert len(providers) >= 4
    assert any(s["model"] == "nova-2-lite-v1" for s in samples)
    assert any(s["model"] == "nova-premier-v1" for s in samples)
