from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

import backend.config as _config

logger = logging.getLogger(__name__)

JWT_SECRET_PATH: Path = _config.BASE_DIR / "data" / "jwt_secret.txt"


def load_jwt_secret() -> str:
    """Load JWT secret from env or data file, else generate an ephemeral secret.

    This function does not write to disk; persistence is an explicit admin action.
    """
    secret = os.environ.get("JWT_SECRET", "").strip()
    if secret:
        return secret

    try:
        secret = JWT_SECRET_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        secret = ""

    if secret:
        return secret

    logger.warning(
        "JWT_SECRET is not configured; using an ephemeral secret. "
        "Tokens will become invalid on restart. Persist via the admin endpoint."
    )
    return secrets.token_hex(32)


def persist_jwt_secret(secret: str) -> None:
    JWT_SECRET_PATH.parent.mkdir(parents=True, exist_ok=True)
    JWT_SECRET_PATH.write_text(secret.strip() + "\n", encoding="utf-8")

