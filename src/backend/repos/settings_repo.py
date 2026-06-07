from __future__ import annotations

from backend.db import db_connection


def seed_router_system_message(default_message: str) -> None:
    with db_connection() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO app_settings (key, value) "
            "VALUES ('router_llm_system_message', ?)",
            [default_message],
        )


def get_settings(keys: list[str] | None = None) -> dict[str, str]:
    with db_connection() as conn:
        if keys:
            placeholders = ",".join("?" for _ in keys)
            rows = conn.execute(
                f"SELECT key, value FROM app_settings WHERE key IN ({placeholders})",
                keys,
            ).fetchall()
        else:
            rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
    return {r["key"]: r["value"] for r in rows}


def upsert_settings(updates: dict[str, str]) -> None:
    if not updates:
        return
    with db_connection() as conn:
        for k, v in updates.items():
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
                [k, v],
            )
