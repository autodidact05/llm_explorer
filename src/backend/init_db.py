import logging
import sqlite3

import backend.config as _config
from backend.db import db_connection

logger = logging.getLogger(__name__)


_HTTP_STATUS: dict[int, str] = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    402: "Payment Required",
    403: "Forbidden",
    404: "Not Found",
    408: "Request Timeout",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
}


def http_details(code: int) -> str:
    """Return a human-readable description for an HTTP status code."""
    return _HTTP_STATUS.get(code, f"HTTP {code}")


def _try(conn: object, sql: str) -> None:  # type: ignore[type-arg]
    try:
        conn.execute(sql)  # type: ignore[union-attr]
    except sqlite3.OperationalError as exc:
        # Used for idempotent DDL attempts where "already exists" / "no such column" is fine.
        logger.debug("DB init skipped: %s (%s)", sql, exc)
    except Exception as exc:
        logger.warning("DB init unexpected failure: %s (%s)", sql, exc)


def initialize_database() -> None:
    with db_connection() as conn:
        # ── Schema renames (idempotent — fail silently if already done) ──────
        _try(conn, "ALTER TABLE credits RENAME TO balance")
        _try(conn, "ALTER TABLE users RENAME COLUMN id TO users_id")
        _try(conn, "ALTER TABLE model_pricing RENAME COLUMN id TO model_id")

        # ── Core tables ──────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS model_pricing (
                model_id           INTEGER PRIMARY KEY AUTOINCREMENT,
                router             TEXT    NOT NULL DEFAULT 'openrouter',
                provider           TEXT    NOT NULL,
                model              TEXT    NOT NULL,
                category           TEXT,
                description        TEXT,
                context_length     INTEGER,
                input_per_million  REAL    NOT NULL CHECK (input_per_million >= 0),
                output_per_million REAL    NOT NULL CHECK (output_per_million >= 0),
                last_updated       TEXT    NOT NULL
                                           DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
                status             TEXT    NOT NULL DEFAULT 'active'
                                           CHECK (status IN ('active', 'expired')),
                is_local           INTEGER NOT NULL DEFAULT 0
                                           CHECK (is_local IN (0, 1)),
                sync_source        TEXT    DEFAULT NULL,
                UNIQUE (router, provider, model)
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS usage_audit (
                event_id        INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at      TEXT    NOT NULL
                                        DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
                router          TEXT    NOT NULL DEFAULT 'openrouter',
                provider        TEXT    NOT NULL,
                model           TEXT    NOT NULL,
                prompt_tokens   INTEGER NOT NULL CHECK (prompt_tokens >= 0),
                response_tokens INTEGER NOT NULL CHECK (response_tokens >= 0),
                input_cost      REAL    NOT NULL CHECK (input_cost >= 0),
                output_cost     REAL    NOT NULL CHECK (output_cost >= 0),
                time_taken      REAL    NOT NULL CHECK (time_taken >= 0),
                http_code       INTEGER NOT NULL,
                http_details    TEXT,
                conversation_id INTEGER,
                session_id      INTEGER,
                interaction_id  INTEGER,
                message_id      INTEGER
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_usage_audit_created_at
            ON usage_audit (created_at)
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_usage_audit_model
            ON usage_audit (router, provider, model)
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS balance (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at      TEXT    NOT NULL
                                        DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
                amount          REAL    NOT NULL CHECK (amount != 0),
                description     TEXT    NOT NULL,
                conversation_id INTEGER
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS expense_log (
                expense_id      INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at      TEXT    NOT NULL
                                        DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
                event_id        INTEGER NOT NULL,
                conversation_id INTEGER,
                session_id      INTEGER,
                interaction_id  INTEGER,
                message_id      INTEGER,
                input_cost      REAL    NOT NULL CHECK (input_cost >= 0),
                output_cost     REAL    NOT NULL CHECK (output_cost >= 0)
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_expense_log_conversation
            ON expense_log (conversation_id)
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_expense_log_session
            ON expense_log (session_id)
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS currency_rates (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                currency_code TEXT    NOT NULL,
                rate          REAL    NOT NULL,
                fetched_date  TEXT    NOT NULL,
                UNIQUE (currency_code, fetched_date)
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_conversations (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT,
                created_at TEXT NOT NULL
                                   DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS api_keys (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL,
                provider    TEXT    NOT NULL DEFAULT 'openrouter',
                key_value   TEXT    NOT NULL,
                key_preview TEXT    NOT NULL,
                is_active   INTEGER NOT NULL DEFAULT 0
                                    CHECK (is_active IN (0, 1)),
                created_at  TEXT    NOT NULL
                                    DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                users_id      INTEGER PRIMARY KEY AUTOINCREMENT,
                email_hash    TEXT    NOT NULL UNIQUE,
                password_hash TEXT    NOT NULL,
                password_salt TEXT    NOT NULL,
                created_at    TEXT    NOT NULL
                                      DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
                last_login    TEXT
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT,
                status     TEXT    NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'ended')),
                created_at TEXT    NOT NULL
                                   DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
                ended_at   TEXT
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_interactions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL
                                   REFERENCES chat_sessions(id) ON DELETE CASCADE,
                provider   TEXT    NOT NULL,
                model      TEXT    NOT NULL,
                created_at TEXT    NOT NULL
                                   DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_interactions_session
            ON chat_interactions (session_id)
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_interactions_lookup
            ON chat_interactions (session_id, provider, model)
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id     INTEGER NOT NULL
                                       REFERENCES chat_sessions(id) ON DELETE CASCADE,
                interaction_id INTEGER,
                role           TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
                content        TEXT    NOT NULL,
                model          TEXT,
                provider       TEXT,
                event_id       INTEGER,
                created_at     TEXT    NOT NULL
                                       DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session
            ON chat_messages (session_id)
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS routing_ratings (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                interaction_id INTEGER NOT NULL,
                rating         INTEGER NOT NULL CHECK (rating IN (1, 2, 3)),
                comment        TEXT,
                created_at     TEXT    NOT NULL
                                       DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS response_ratings (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL UNIQUE,
                rating     INTEGER NOT NULL CHECK (rating IN (1, 2, 3)),
                comment    TEXT,
                created_at TEXT    NOT NULL
                                   DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS routing_logs (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at      TEXT    NOT NULL
                                        DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
                session_id      INTEGER,
                conversation_id INTEGER,
                message_id      INTEGER,
                router_provider TEXT    NOT NULL,
                router_model    TEXT    NOT NULL,
                chosen_provider TEXT    NOT NULL,
                chosen_model    TEXT    NOT NULL,
                routing_reason  TEXT,
                estimated_cost  TEXT,
                confidence      REAL,
                router_event_id INTEGER,
                prompt_version  TEXT
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_send_idempotency (
                session_id       INTEGER NOT NULL,
                idempotency_key  TEXT    NOT NULL,
                response_json    TEXT    NOT NULL,
                created_at       TEXT    NOT NULL
                                         DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
                PRIMARY KEY (session_id, idempotency_key)
            )
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_routing_logs_session
            ON routing_logs (session_id)
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_routing_logs_created_at
            ON routing_logs (created_at)
        """)

        # ── Column additions (idempotent) ────────────────────────────────────
        for sql in [
            "ALTER TABLE usage_audit ADD COLUMN http_details TEXT",
            "ALTER TABLE usage_audit ADD COLUMN conversation_id INTEGER",
            "ALTER TABLE usage_audit ADD COLUMN session_id INTEGER",
            "ALTER TABLE usage_audit ADD COLUMN interaction_id INTEGER",
            "ALTER TABLE usage_audit ADD COLUMN message_id INTEGER",
            "ALTER TABLE balance ADD COLUMN conversation_id INTEGER",
            "ALTER TABLE users ADD COLUMN last_login TEXT",
            "ALTER TABLE chat_messages ADD COLUMN interaction_id INTEGER",
            "ALTER TABLE chat_sessions ADD COLUMN conversation_id INTEGER",
            "ALTER TABLE model_pricing ADD COLUMN sync_source TEXT DEFAULT NULL",
            "ALTER TABLE chat_conversations ADD COLUMN system_message TEXT",
            "ALTER TABLE chat_interactions ADD COLUMN routed_by TEXT",
            "ALTER TABLE chat_interactions ADD COLUMN routing_reason TEXT",
            "ALTER TABLE chat_interactions ADD COLUMN router_estimated_cost TEXT",
            "ALTER TABLE chat_interactions ADD COLUMN router_confidence REAL",
            "ALTER TABLE routing_logs ADD COLUMN prompt_version TEXT",
            "ALTER TABLE chat_conversations ADD COLUMN user_id INTEGER",
            "ALTER TABLE chat_sessions ADD COLUMN user_id INTEGER",
            "ALTER TABLE chat_sessions ADD COLUMN active_branch_id INTEGER DEFAULT 1",
            "ALTER TABLE chat_messages ADD COLUMN branch_id INTEGER DEFAULT 1",
        ]:
            _try(conn, sql)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_branches (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id      INTEGER NOT NULL
                                        REFERENCES chat_sessions(id) ON DELETE CASCADE,
                fork_message_id INTEGER NOT NULL
                                        REFERENCES chat_messages(id) ON DELETE CASCADE,
                label           TEXT    NOT NULL,
                created_at      TEXT    NOT NULL
                                        DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_branches_session
            ON chat_branches (session_id)
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS contact_submissions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER,
                user_email TEXT,
                subject    TEXT    NOT NULL,
                message    TEXT    NOT NULL,
                rating     INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                created_at TEXT    NOT NULL
                                   DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at
            ON contact_submissions (created_at)
        """)

        # ── Seed default app_settings (idempotent) ───────────────────────────
        conn.execute(
            "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
            ("router_llm_provider", "openai"),
        )
        conn.execute(
            "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
            ("router_llm_model", "gpt-4o-mini"),
        )
        conn.execute(
            "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
            ("active_llm_routing", "openrouter"),
        )

        # ── Key renames (idempotent) ─────────────────────────────────────────
        _try(
            conn,
            "UPDATE app_settings SET key = 'router_llm_enabled' "
            "WHERE key = 'master_llm_enabled'",
        )
        _try(
            conn,
            "UPDATE app_settings SET key = 'router_llm_system_message' "
            "WHERE key = 'master_llm_system_message'",
        )
        _try(
            conn,
            "UPDATE chat_interactions SET routed_by = 'router_llm' "
            "WHERE routed_by = 'master_llm'",
        )

        # ── Fix: local_csv models are OpenRouter cloud models, not local ────────
        conn.execute(
            "UPDATE model_pricing SET is_local = 0 WHERE sync_source = 'local_csv' AND is_local = 1"
        )

        # ── Backfill: sessions without a conversation ────────────────────────
        conn.execute("""
            INSERT OR IGNORE INTO chat_conversations (id, title, created_at)
            SELECT id, title, created_at FROM chat_sessions WHERE conversation_id IS NULL
        """)
        conn.execute(
            "UPDATE chat_sessions SET conversation_id = id WHERE conversation_id IS NULL"
        )

    try:
        from backend.crypto_service import migrate_plaintext_api_keys

        migrate_plaintext_api_keys()
    except Exception as exc:
        logger.warning("API key encryption migration skipped: %s", exc)

    logger.info("Database initialized at %s", _config.DB_PATH)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    initialize_database()
    print("Database initialized.")
