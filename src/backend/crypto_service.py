from __future__ import annotations

import base64
import hashlib
import logging
import os

from cryptography.fernet import Fernet, InvalidToken

import backend.config as _config
from backend.secrets import load_jwt_secret

logger = logging.getLogger(__name__)

ENC_PREFIX = "enc:"


def _derive_fernet_key() -> bytes:
    raw = os.environ.get("ENCRYPTION_KEY", "").strip()
    if not raw:
        raw = os.environ.get("JWT_SECRET", "").strip()
    if not raw:
        raw = load_jwt_secret()
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _fernet() -> Fernet:
    return Fernet(_derive_fernet_key())


def encrypt_secret(plain: str) -> str:
    if not plain:
        return plain
    token = _fernet().encrypt(plain.encode("utf-8")).decode("ascii")
    return f"{ENC_PREFIX}{token}"


def decrypt_secret(stored: str) -> str:
    if not stored:
        return stored
    if not stored.startswith(ENC_PREFIX):
        return stored
    try:
        return _fernet().decrypt(stored[len(ENC_PREFIX) :].encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        logger.error("Failed to decrypt stored secret — check ENCRYPTION_KEY/JWT_SECRET")
        raise RuntimeError("Stored API key could not be decrypted") from exc


def migrate_plaintext_api_keys() -> None:
    """Encrypt existing plaintext api_keys rows (idempotent)."""
    from backend.db import db_connection

    with db_connection() as conn:
        rows = conn.execute("SELECT id, key_value FROM api_keys").fetchall()
        for row in rows:
            val = str(row["key_value"])
            if val.startswith(ENC_PREFIX):
                continue
            conn.execute(
                "UPDATE api_keys SET key_value = ? WHERE id = ?",
                [encrypt_secret(val), row["id"]],
            )
