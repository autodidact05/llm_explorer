import json

import pytest

import backend.config as config
from backend.audit_service import insert_usage_audit
from backend.db import db_connection

MESSAGES = [{"role": "user", "content": "Hello"}]
RESPONSE = "Hi there!"


def _insert(**kwargs: object) -> int:
    defaults: dict[str, object] = dict(
        provider="meta-llama",
        model="llama-3.1-8b-instruct",
        prompt_tokens=17,
        response_tokens=440,
        input_cost=0.000004505,
        output_cost=0.00021516,
        time_taken=1.23,
        http_code=200,
        prompt_messages=MESSAGES,
        response_content=RESPONSE,
    )
    defaults.update(kwargs)
    return insert_usage_audit(**defaults)  # type: ignore[arg-type]


def test_insert_valid_audit_record():
    _insert()
    with db_connection() as conn:
        count = conn.execute("SELECT COUNT(*) FROM usage_audit").fetchone()[0]
    assert count == 1


def test_insert_returns_event_id():
    event_id = _insert()
    assert isinstance(event_id, int)
    assert event_id >= 1


def test_audit_record_stores_correct_values():
    _insert(
        model="llama-3.3-70b-instruct",
        prompt_tokens=10,
        response_tokens=200,
        input_cost=0.001,
        output_cost=0.002,
        time_taken=2.5,
        http_code=200,
    )
    with db_connection() as conn:
        row = conn.execute("SELECT * FROM usage_audit").fetchone()
    assert row["provider"] == "meta-llama"
    assert row["model"] == "llama-3.3-70b-instruct"
    assert row["router"] == "openrouter"
    assert row["prompt_tokens"] == 10
    assert row["response_tokens"] == 200
    assert row["input_cost"] == pytest.approx(0.001)
    assert row["output_cost"] == pytest.approx(0.002)
    assert row["time_taken"] == pytest.approx(2.5)
    assert row["http_code"] == 200
    assert row["created_at"] is not None


def test_jsonl_entry_written():
    event_id = _insert()
    log_path = config.LOG_PATH
    assert log_path.exists()
    entry = json.loads(log_path.read_text(encoding="utf-8").strip())
    assert entry["event_id"] == event_id
    assert entry["prompt_json"] == MESSAGES
    assert entry["response_json"] == {"role": "assistant", "content": RESPONSE}


def test_jsonl_event_id_matches_db():
    event_id = _insert()
    entry = json.loads(config.LOG_PATH.read_text(encoding="utf-8").strip())
    assert entry["event_id"] == event_id
    with db_connection() as conn:
        row = conn.execute(
            "SELECT event_id FROM usage_audit WHERE event_id = ?", (event_id,)
        ).fetchone()
    assert row["event_id"] == event_id


def test_negative_prompt_tokens_raises():
    with pytest.raises(ValueError, match="non-negative"):
        _insert(prompt_tokens=-1)


def test_negative_response_tokens_raises():
    with pytest.raises(ValueError, match="non-negative"):
        _insert(response_tokens=-1)


def test_negative_input_cost_raises():
    with pytest.raises(ValueError, match="non-negative"):
        _insert(input_cost=-0.001)


def test_negative_output_cost_raises():
    with pytest.raises(ValueError, match="non-negative"):
        _insert(output_cost=-0.002)


def test_negative_time_taken_raises():
    with pytest.raises(ValueError, match="non-negative"):
        _insert(time_taken=-1.0)
