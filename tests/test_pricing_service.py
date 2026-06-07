import pytest

from backend.pricing_service import get_model_pricing, upsert_model_pricing


def test_upsert_and_retrieve():
    upsert_model_pricing("meta-llama", "llama-3.1-8b-instruct", 0.041, 0.069)
    input_rate, output_rate = get_model_pricing("meta-llama", "llama-3.1-8b-instruct")
    assert input_rate == pytest.approx(0.041)
    assert output_rate == pytest.approx(0.069)


def test_upsert_updates_existing_row():
    upsert_model_pricing("meta-llama", "llama-3.1-8b-instruct", 0.041, 0.069)
    upsert_model_pricing("meta-llama", "llama-3.1-8b-instruct", 0.050, 0.080)
    input_rate, output_rate = get_model_pricing("meta-llama", "llama-3.1-8b-instruct")
    assert input_rate == pytest.approx(0.050)
    assert output_rate == pytest.approx(0.080)


def test_upsert_does_not_create_duplicates():
    upsert_model_pricing("meta-llama", "llama-3.1-8b-instruct", 0.041, 0.069)
    upsert_model_pricing("meta-llama", "llama-3.1-8b-instruct", 0.050, 0.080)
    from backend.db import db_connection
    with db_connection() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM model_pricing WHERE provider=? AND model=?",
            ("meta-llama", "llama-3.1-8b-instruct"),
        ).fetchone()[0]
    assert count == 1


def test_get_pricing_unknown_model_raises():
    with pytest.raises(ValueError, match="No pricing found"):
        get_model_pricing("unknown-provider", "unknown-model")


def test_multiple_models_independent():
    upsert_model_pricing("meta-llama", "llama-3.1-8b-instruct", 0.041, 0.069)
    upsert_model_pricing("meta-llama", "llama-3.3-70b-instruct", 0.265, 0.489)
    r1 = get_model_pricing("meta-llama", "llama-3.1-8b-instruct")
    r2 = get_model_pricing("meta-llama", "llama-3.3-70b-instruct")
    assert r1 == pytest.approx((0.041, 0.069))
    assert r2 == pytest.approx((0.265, 0.489))
