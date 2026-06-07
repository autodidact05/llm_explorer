from __future__ import annotations

import time

import jwt
from fastapi.testclient import TestClient

from backend.http.app import create_app


def test_invalid_token_rejected() -> None:
    app = create_app()
    with TestClient(app) as client:
        assert (
            client.get("/api/stats", headers={"Authorization": "Bearer invalid-token"}).status_code
            == 401
        )


def test_expired_token_rejected() -> None:
    app = create_app()
    secret = app.state.jwt_secret
    expired = jwt.encode(
        {"sub": "1", "email": "x@y.com", "exp": int(time.time()) - 60},
        secret,
        algorithm="HS256",
    )
    with TestClient(app) as client:
        assert client.get("/api/stats", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
