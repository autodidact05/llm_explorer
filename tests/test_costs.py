import pytest

from backend.llm_common import calculate_cost


def test_one_million_tokens_at_one_dollar():
    assert calculate_cost(1_000_000, 1.0) == pytest.approx(1.0)


def test_small_prompt_llama_70b_input():
    # 17 tokens at $0.265/million
    assert calculate_cost(17, 0.265) == pytest.approx(4.505e-6)


def test_completion_llama_70b_output():
    # 440 tokens at $0.489/million
    assert calculate_cost(440, 0.489) == pytest.approx(2.1516e-4)


def test_zero_tokens():
    assert calculate_cost(0, 1.0) == pytest.approx(0.0)


def test_zero_rate():
    assert calculate_cost(1000, 0.0) == pytest.approx(0.0)
