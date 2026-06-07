from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, datetime, timedelta

import jwt


def hash_email(email: str) -> str:
    return hashlib.sha256(email.lower().strip().encode()).hexdigest()


def hash_password(password: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode(),
        bytes.fromhex(salt_hex),
        260_000,
    ).hex()


def verify_password(*, password: str, salt_hex: str, expected_hash: str) -> bool:
    actual = hash_password(password, salt_hex)
    return hmac.compare_digest(actual, expected_hash)


def make_token(*, jwt_secret: str, user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": datetime.now(UTC) + timedelta(days=30),
    }
    return jwt.encode(payload, jwt_secret, algorithm="HS256")
