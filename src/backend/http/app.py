from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.http.constants import ALLOWED_ORIGINS
from backend.use_cases.routing_defaults import DEFAULT_ROUTER_SYSTEM_MESSAGE
from backend.http.middleware import auth_middleware
from backend.http.routers import (
    auth,
    wallet,
    chat,
    config,
    currency,
    generated_images,
    invoke,
    keys,
    models,
    ollama,
    openrouter,
    settings,
    stats,
    usage,
    contact,
)
import backend.config as _cfg
from backend.init_db import initialize_database
from backend.repos.settings_repo import seed_router_system_message
from backend.secrets import load_jwt_secret
from backend.use_cases.llm_routing import apply_active_llm_routing
from backend.use_cases.startup import get_active_api_key_or_none, run_startup_jobs

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Schema + default settings, then background catalogue/balance sync (non-fatal on failure).
    initialize_database()
    seed_router_system_message(DEFAULT_ROUTER_SYSTEM_MESSAGE)
    apply_active_llm_routing()

    api_key = get_active_api_key_or_none()
    try:
        await run_startup_jobs(api_key=api_key)
    except Exception as exc:
        logger.warning("Startup jobs failed: %s", exc)

    yield


def create_app() -> FastAPI:
    app = FastAPI(title="LLM Explorer", version="0.1.0", lifespan=_lifespan)

    app.state.allowed_origins = set(ALLOWED_ORIGINS)
    app.state.jwt_secret = load_jwt_secret()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
    )
    app.middleware("http")(auth_middleware())

    app.include_router(stats.router)
    app.include_router(models.router)
    app.include_router(usage.router)
    app.include_router(wallet.router)
    app.include_router(settings.router)
    app.include_router(invoke.router)
    app.include_router(chat.router)
    app.include_router(keys.router)
    app.include_router(currency.router)
    app.include_router(config.router)
    app.include_router(auth.router)
    app.include_router(openrouter.router)
    app.include_router(ollama.router)
    app.include_router(generated_images.router)
    app.include_router(contact.router)

    _cfg.GENERATED_IMAGES_PATH.mkdir(parents=True, exist_ok=True)

    return app


app = create_app()


def start() -> None:
    import os

    import uvicorn

    host = os.environ.get("API_HOST", "127.0.0.1")
    port = int(os.environ.get("API_PORT", "8000"))
    reload = os.environ.get("API_RELOAD", "1").strip().lower() in ("1", "true", "yes")
    uvicorn.run("backend.api:app", host=host, port=port, reload=reload)

