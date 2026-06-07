import pytest
from fastapi import HTTPException

from backend.repos.settings_keys import SettingsKey
from backend.repos.settings_repo import upsert_settings
from backend.config import GROQ_SUPPORTED_MODELS
from backend.use_cases.groq_models import sync_groq_models
from backend.use_cases.llm_routing import (
    ROUTING_GROQ,
    ROUTING_OPENROUTER,
    catalog_sql_clause,
    get_active_llm_routing,
    get_routing_status,
    routing_lane_for_stored_provider,
    set_active_llm_routing,
)


def test_routing_lane_for_provider() -> None:
    assert routing_lane_for_stored_provider("groq") == ROUTING_GROQ
    assert routing_lane_for_stored_provider("openrouter") == ROUTING_OPENROUTER
    assert routing_lane_for_stored_provider("openai") == ROUTING_OPENROUTER


def test_dual_lane_active_keys(tmp_path, monkeypatch) -> None:
    from backend import config
    from backend.crypto_service import encrypt_secret
    from backend.db import db_connection
    from backend.init_db import initialize_database

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "routing.db")
    initialize_database()

    with db_connection() as conn:
        conn.execute(
            "INSERT INTO api_keys (name, provider, key_value, key_preview, is_active) "
            "VALUES (?, ?, ?, ?, 1)",
            ["OR", "openrouter", encrypt_secret("sk-or-test"), "sk-or-t…"],
        )
        conn.execute(
            "INSERT INTO api_keys (name, provider, key_value, key_preview, is_active) "
            "VALUES (?, ?, ?, ?, 1)",
            ["GQ", "groq", encrypt_secret("gsk_test"), "gsk_t…"],
        )

    upsert_settings({SettingsKey.ACTIVE_LLM_ROUTING: ROUTING_OPENROUTER})
    assert get_active_llm_routing() == ROUTING_OPENROUTER

    set_active_llm_routing(ROUTING_GROQ)
    assert get_active_llm_routing() == ROUTING_GROQ

    status = get_routing_status()
    assert status["openrouter"]["configured"] is True
    assert status["groq"]["configured"] is True
    assert status["groq"]["enabled"] is True
    assert status["openrouter"]["enabled"] is False


def test_catalog_sql_clause_groq_only(tmp_path, monkeypatch) -> None:
    from backend import config
    from backend.crypto_service import encrypt_secret
    from backend.db import db_connection
    from backend.init_db import initialize_database
    from backend.pricing_service import upsert_model_pricing

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "catalog.db")
    initialize_database()
    sync_groq_models()
    upsert_model_pricing("openai", "gpt-4o-mini", 1.0, 2.0)

    upsert_settings({SettingsKey.ACTIVE_LLM_ROUTING: ROUTING_GROQ})
    clause, params = catalog_sql_clause()
    with db_connection() as conn:
        rows = conn.execute(
            f"SELECT provider, model FROM model_pricing WHERE status = 'active' AND {clause}",
            params,
        ).fetchall()
    models = {(r["provider"], r["model"]) for r in rows}
    assert models == {("groq", m) for m in GROQ_SUPPORTED_MODELS}


def test_set_routing_requires_key(tmp_path, monkeypatch) -> None:
    from backend import config
    from backend.init_db import initialize_database

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "empty.db")
    initialize_database()
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with pytest.raises(HTTPException) as exc:
        set_active_llm_routing(ROUTING_GROQ)
    assert exc.value.status_code == 400
