from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.db import db_connection
from backend.http.auth_cookies import (
    AUTH_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    auth_cookie_kwargs,
)
from backend.use_cases import auth as auth_uc

router = APIRouter()


class AuthRequest(BaseModel):
    email: str
    password: str


def _set_auth_cookies(response: Response, token: str) -> None:
    csrf = secrets.token_urlsafe(32)
    secure = False
    response.set_cookie(AUTH_COOKIE_NAME, token, **auth_cookie_kwargs(secure=secure))  # type: ignore[arg-type]
    response.set_cookie(
        CSRF_COOKIE_NAME,
        csrf,
        httponly=False,
        samesite="lax",
        secure=secure,
        max_age=30 * 24 * 3600,
        path="/",
    )


@router.get("/api/auth/status")
def auth_status() -> dict[str, Any]:
    with db_connection() as conn:
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    return {"users_registered": count > 0}


@router.post("/api/auth/register")
def auth_register(req: Request, body: AuthRequest) -> JSONResponse:
    email = body.email.strip().lower()
    if not email or not body.password:
        raise HTTPException(400, "Email and password are required")

    jwt_secret: str | None = getattr(req.app.state, "jwt_secret", None)
    if not jwt_secret:
        raise HTTPException(500, "Server misconfigured")

    email_hash = auth_uc.hash_email(email)
    salt = secrets.token_hex(32)
    pw_hash = auth_uc.hash_password(body.password, salt)
    try:
        with db_connection() as conn:
            cur = conn.execute(
                "INSERT INTO users (email_hash, password_hash, password_salt) VALUES (?, ?, ?)",
                [email_hash, pw_hash, salt],
            )
            user_id = cur.lastrowid
    except Exception as exc:
        raise HTTPException(409, "An account with this email already exists") from exc

    token = auth_uc.make_token(jwt_secret=jwt_secret, user_id=int(user_id), email=email)
    response = JSONResponse({"token": token, "email": email, "csrf_header": CSRF_HEADER_NAME})
    _set_auth_cookies(response, token)
    return response


@router.post("/api/auth/login")
def auth_login(req: Request, body: AuthRequest) -> JSONResponse:
    email = body.email.strip().lower()
    jwt_secret: str | None = getattr(req.app.state, "jwt_secret", None)
    if not jwt_secret:
        raise HTTPException(500, "Server misconfigured")

    email_hash = auth_uc.hash_email(email)
    with db_connection() as conn:
        row = conn.execute(
            "SELECT users_id, password_hash, password_salt FROM users WHERE email_hash = ?",
            [email_hash],
        ).fetchone()
    if not row:
        raise HTTPException(401, "Invalid email or password")

    if not auth_uc.verify_password(
        password=body.password,
        salt_hex=str(row["password_salt"]),
        expected_hash=str(row["password_hash"]),
    ):
        raise HTTPException(401, "Invalid email or password")

    with db_connection() as conn:
        conn.execute(
            "UPDATE users SET last_login = strftime('%Y-%m-%dT%H:%M:%f', 'now') "
            "WHERE users_id = ?",
            [row["users_id"]],
        )

    token = auth_uc.make_token(
        jwt_secret=jwt_secret,
        user_id=int(row["users_id"]),
        email=email,
    )
    response = JSONResponse({"token": token, "email": email, "csrf_header": CSRF_HEADER_NAME})
    _set_auth_cookies(response, token)
    return response


@router.post("/api/auth/logout")
def auth_logout() -> JSONResponse:
    response = JSONResponse({"status": "ok"})
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")
    return response
