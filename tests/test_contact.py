from backend.db import db_connection
from backend.repos import contact_repo


def test_contact_api_endpoint() -> None:
    from fastapi.testclient import TestClient

    from backend.http.app import create_app

    app = create_app()
    with TestClient(app) as client:
        reg = client.post("/api/auth/register", json={"email": "c@example.com", "password": "pw"})
        token = reg.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        bad = client.post(
            "/api/contact",
            headers=headers,
            json={"subject": "Hi", "message": "Test", "rating": 0},
        )
        assert bad.status_code == 422

        ok = client.post(
            "/api/contact",
            headers=headers,
            json={"subject": "Feedback", "message": "Great app", "rating": 5},
        )
        assert ok.status_code == 200
        assert ok.json()["status"] == "received"

        with db_connection() as conn:
            count = conn.execute("SELECT COUNT(*) FROM contact_submissions").fetchone()[0]
        assert count == 1


def test_insert_contact_submission() -> None:
    row = contact_repo.insert_contact_submission(
        subject="Test subject",
        message="Hello from pytest",
        rating=5,
        user_id=1,
        user_email="test@example.com",
    )
    assert row["id"] > 0
    assert row["subject"] == "Test subject"
    assert row["rating"] == 5
