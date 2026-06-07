from pathlib import Path

import pytest

import backend.config as config
from backend.init_db import initialize_database


@pytest.fixture(autouse=True)
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-for-pytest-32bytes-min")
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(config, "LOG_PATH", tmp_path / "test.jsonl")
    monkeypatch.setattr(config, "MODELS_CSV_PATH", tmp_path / "models.csv")
    monkeypatch.setattr(config, "UPLOADED_DATA_PATH", tmp_path / "uploaded_data")
    initialize_database()
