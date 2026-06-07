"""JWT authentication and CSRF protection for the FastAPI app.

Public routes: ``/api/auth/*``, OpenAPI docs, and ``OPTIONS``.
Token source: ``Authorization: Bearer`` header, else HttpOnly ``auth_token`` cookie.
Mutating requests that use cookie auth (no Bearer header) must send ``X-CSRF-Token``
matching the ``csrf_token`` cookie (double-submit pattern).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

import jwt
from fastapi import Request
from fastapi.responses import JSONResponse, Response

from backend.http.auth_cookies import (
    AUTH_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
)

logger = logging.getLogger(__name__)

_MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _cors_headers(request: Request) -> dict[str, str]:
    origin = request.headers.get("origin", "")
    allowed_origins: set[str] = getattr(request.app.state, "allowed_origins", set())
    if origin in allowed_origins:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }
    return {}


def _extract_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if auth:
        return auth
    return request.cookies.get(AUTH_COOKIE_NAME, "").strip()


def auth_middleware(
    *,
    public_prefixes: tuple[str, ...] = ("/api/auth/",),
    public_paths: tuple[str, ...] = ("/docs", "/redoc", "/openapi.json"),
) -> Callable[[Request, Callable[[Request], Awaitable[Response]]], Awaitable[Response]]:
    async def _middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        path = request.url.path
        cors_headers = _cors_headers(request)

        if (
            path.startswith(public_prefixes)
            or path in public_paths
            or request.method == "OPTIONS"
        ):
            return await call_next(request)

        token = _extract_token(request)
        if not token:
            return JSONResponse(
                {"detail": "Not authenticated"},
                status_code=401,
                headers=cors_headers,
            )

        secret: str | None = getattr(request.app.state, "jwt_secret", None)
        if not secret:
            logger.error("JWT secret missing from app state")
            return JSONResponse(
                {"detail": "Server misconfigured"},
                status_code=500,
                headers=cors_headers,
            )

        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            return JSONResponse(
                {"detail": "Invalid or expired token"},
                status_code=401,
                headers=cors_headers,
            )

        request.state.user_id = int(payload["sub"])
        request.state.user_email = str(payload.get("email", ""))

        bearer = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        if (
            request.method in _MUTATING
            and request.cookies.get(AUTH_COOKIE_NAME)
            and not bearer
            and not path.startswith("/api/auth/")
        ):
            csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME, "")
            csrf_header = request.headers.get(CSRF_HEADER_NAME, "")
            if not csrf_cookie or csrf_cookie != csrf_header:
                return JSONResponse(
                    {"detail": "CSRF validation failed"},
                    status_code=403,
                    headers=cors_headers,
                )

        return await call_next(request)

    return _middleware
