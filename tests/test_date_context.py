from __future__ import annotations

from backend.date_context import append_date_context, build_date_context
from backend.use_cases.agent_client import prepare_agent_messages


def test_build_date_context_mentions_utc_and_iso() -> None:
    text = build_date_context()
    assert "(UTC," in text
    assert "authoritative current date" in text


def test_append_date_context_with_message() -> None:
    text = append_date_context("You are helpful.")
    assert text.startswith("You are helpful.")
    assert "(UTC," in text


def test_append_date_context_without_message() -> None:
    text = append_date_context(None)
    assert text.startswith("Today's date is")


def test_prepare_agent_messages_includes_system_and_user_date() -> None:
    prepared = prepare_agent_messages([
        {"role": "system", "content": "Be helpful."},
        {"role": "user", "content": "What day is this Friday?"},
    ])
    assert prepared[0]["role"] == "system"
    assert "Today's date is" in str(prepared[0]["content"])
    assert prepared[1]["role"] == "user"
    assert "Today's date is" in str(prepared[1]["content"])
    assert "What day is this Friday?" in str(prepared[1]["content"])


def test_prepare_agent_messages_adds_system_when_missing() -> None:
    prepared = prepare_agent_messages([{"role": "user", "content": "Hello"}])
    assert prepared[0]["role"] == "system"
    assert "Today's date is" in str(prepared[0]["content"])
