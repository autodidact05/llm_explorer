from __future__ import annotations

from backend.use_cases.agent_client import split_system_and_conversation


def test_split_system_and_conversation() -> None:
    messages = [
        {"role": "system", "content": "Be helpful."},
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi"},
        {"role": "user", "content": "Again"},
    ]
    instructions, conversation = split_system_and_conversation(messages)
    assert instructions == "Be helpful."
    assert len(conversation) == 3
    assert conversation[0]["content"] == "Hello"


def test_split_system_and_conversation_merges_multiple_system() -> None:
    messages = [
        {"role": "system", "content": "First"},
        {"role": "system", "content": "Second"},
        {"role": "user", "content": "Hi"},
    ]
    instructions, conversation = split_system_and_conversation(messages)
    assert instructions == "First\n\nSecond"
    assert conversation == [{"role": "user", "content": "Hi"}]
