from __future__ import annotations

AUTH_COOKIE_NAME = "llm_explorer_token"
CSRF_COOKIE_NAME = "llm_explorer_csrf"
CSRF_HEADER_NAME = "X-CSRF-Token"


def auth_cookie_kwargs(*, secure: bool = False) -> dict[str, object]:
    return {
        "httponly": True,
        "samesite": "lax",
        "secure": secure,
        "max_age": 30 * 24 * 3600,
        "path": "/",
    }
