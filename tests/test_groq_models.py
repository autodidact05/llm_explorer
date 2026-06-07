import pytest
from fastapi import HTTPException

from backend.config import GROQ_SUPPORTED_MODELS
from backend.use_cases.groq_models import (
    assert_groq_model_allowed,
    ensure_groq_catalog,
    groq_catalog_count,
    sync_groq_models,
)


def test_groq_supported_model_set() -> None:
    assert GROQ_SUPPORTED_MODELS == frozenset({
        "llama-3.1-8b-instant",
        "llama-3.3-70b-versatile",
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
    })


def test_assert_groq_model_allowed_passes() -> None:
    assert_groq_model_allowed(provider="groq", model="llama-3.1-8b-instant")


def test_assert_groq_model_allowed_rejects() -> None:
    with pytest.raises(HTTPException) as exc:
        assert_groq_model_allowed(provider="groq", model="mixtral-8x7b-32768")
    assert exc.value.status_code == 400
    assert "Unsupported Groq model" in exc.value.detail


def test_assert_groq_skips_non_groq_provider() -> None:
    assert_groq_model_allowed(provider="openai", model="gpt-4o")


def test_ensure_groq_catalog_populates_empty_db(tmp_path, monkeypatch) -> None:
    from backend import config
    from backend.init_db import initialize_database
    from backend.repos.settings_keys import SettingsKey
    from backend.repos.settings_repo import upsert_settings
    from backend.use_cases.llm_routing import ROUTING_GROQ, catalog_sql_clause

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "ensure.db")
    initialize_database()
    assert groq_catalog_count() == 0
    upsert_settings({SettingsKey.ACTIVE_LLM_ROUTING: ROUTING_GROQ})
    ensure_groq_catalog()
    assert groq_catalog_count() == 4
    clause, params = catalog_sql_clause()
    from backend.db import db_connection

    with db_connection() as conn:
        n = conn.execute(
            f"SELECT COUNT(*) FROM model_pricing WHERE status = 'active' AND {clause}",
            params,
        ).fetchone()[0]
    assert n == 4


def test_sync_groq_models_upserts_four(tmp_path, monkeypatch) -> None:
    from backend import config
    from backend.db import db_connection
    from backend.init_db import initialize_database

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    initialize_database()
    output = sync_groq_models()
    assert "4 model" in output
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT model FROM model_pricing WHERE router = 'groq' AND status = 'active'"
        ).fetchall()
    models = {r["model"] for r in rows}
    assert models == set(GROQ_SUPPORTED_MODELS)
