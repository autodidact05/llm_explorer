from __future__ import annotations

import json

import backend.use_cases.chat as chat_uc
from backend.use_cases.chat_phases import RouterMeta
from backend.use_cases.chat.types import PreparedChatSend


def test_stream_emits_done_event(monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from backend.http.app import create_app

    prepared = PreparedChatSend(
        session_id=1,
        conv_id=1,
        content="hi",
        llm_messages=[{"role": "user", "content": "hi"}],
        audit_messages=[{"role": "user", "content": "hi"}],
        actual_provider="openai",
        actual_model="gpt-4o-mini",
        is_image_gen=False,
        web_search_used=False,
        web_search_sources=[],
        router_meta=RouterMeta(routed=False),
        router_log_id=None,
        router_provider="openai",
        router_model="gpt-4o-mini",
        router_input_cost=0.0,
        router_output_cost=0.0,
        router_prompt_tokens=0,
        router_response_tokens=0,
        router_llm_enabled=False,
    )

    async def fake_stream(**_kwargs):  # type: ignore[no-untyped-def]
        yield "Hello"
        yield {
            "_usage": True,
            "prompt_tokens": 1,
            "response_tokens": 2,
            "input_cost": 0.0,
            "output_cost": 0.0,
            "time_taken": 0.1,
            "http_code": 200,
        }

    def fake_prepare(**_kwargs):  # type: ignore[no-untyped-def]
        return prepared

    def fake_finalize(prep, result, image_url):  # type: ignore[no-untyped-def]
        return {"content": "Hello", "event_id": 1, "message_id": 2}

    monkeypatch.setattr("backend.use_cases.chat.stream.prepare_chat_context", fake_prepare)
    monkeypatch.setattr("backend.use_cases.chat.stream.apply_router_phase", lambda _p: None)
    monkeypatch.setattr("backend.use_cases.chat.stream.apply_web_search_phase", lambda _p: None)
    monkeypatch.setattr("backend.use_cases.chat.stream.apply_image_model_defaults", lambda _p: None)
    monkeypatch.setattr("backend.use_cases.chat.stream.stream_answering_agent", fake_stream)
    monkeypatch.setattr("backend.use_cases.chat.stream.finalize_chat_send", fake_finalize)

    app = create_app()
    with TestClient(app) as client:
        reg = client.post("/api/auth/register", json={"email": "s@example.com", "password": "pw"})
        token = reg.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        sess = client.post("/api/chat/sessions", headers=headers, json={})
        session_id = sess.json()["id"]

        with client.stream(
            "POST",
            f"/api/chat/sessions/{session_id}/messages/stream",
            headers=headers,
            json={"provider": "openai", "model": "gpt-4o-mini", "content": "hi"},
        ) as res:
            assert res.status_code == 200
            chunks = "".join(res.iter_text())
        assert '"type": "done"' in chunks or '"type":"done"' in chunks.replace(" ", "")
