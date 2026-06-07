from __future__ import annotations

import backend.use_cases.chat as chat_uc


def test_auth_middleware_protects_routes() -> None:
    from fastapi.testclient import TestClient

    from backend.http.app import create_app

    app = create_app()
    with TestClient(app) as client:
        assert client.get("/api/auth/status").status_code == 200
        assert client.get("/api/stats").status_code == 401


def test_chat_send_flow_writes_db(monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from backend.db import db_connection
    from backend.http.app import create_app

    def fake_invoke_answering_agent(*, provider: str, model: str, messages: list[dict[str, object]]):  # type: ignore[override]
        return {
            "content": "hi",
            "prompt_tokens": 5,
            "response_tokens": 7,
            "input_cost": 0.001,
            "output_cost": 0.002,
            "time_taken": 0.1,
            "http_code": 200,
        }

    monkeypatch.setattr(
        "backend.use_cases.chat.execute.invoke_answering_agent",
        fake_invoke_answering_agent,
    )

    app = create_app()
    with TestClient(app) as client:
        reg = client.post("/api/auth/register", json={"email": "t@example.com", "password": "pw"})
        assert reg.status_code == 200
        token = reg.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        sess = client.post("/api/chat/sessions", headers=headers, json={})
        assert sess.status_code == 200
        session_id = sess.json()["id"]

        resp = client.post(
            f"/api/chat/sessions/{session_id}/messages",
            headers=headers,
            json={"provider": "openrouter", "model": "any", "content": "Hello"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["content"] == "hi"
        assert isinstance(data["event_id"], int)
        assert isinstance(data["interaction_id"], int)

        with db_connection() as conn:
            msg_count = conn.execute(
                "SELECT COUNT(*) FROM chat_messages WHERE session_id = ?",
                [session_id],
            ).fetchone()[0]
            audit_count = conn.execute("SELECT COUNT(*) FROM usage_audit").fetchone()[0]
            assert msg_count == 2
            assert audit_count == 1
