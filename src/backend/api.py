"""FastAPI application exposing LLM Explorer backend services.

Thin wrapper around `backend.http.app` to keep the original import path stable.
"""

from __future__ import annotations

import os

from backend.http.app import app, start

__all__ = ["app", "start"]


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("API_HOST", "127.0.0.1")
    port = int(os.environ.get("API_PORT", "8000"))
    reload = _env_bool("API_RELOAD", True)
    uvicorn.run("backend.api:app", host=host, port=port, reload=reload)
