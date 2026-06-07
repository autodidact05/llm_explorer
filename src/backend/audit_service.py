"""Persist every LLM HTTP exchange to SQLite and optional JSONL.

Each call gets a monotonic ``event_id`` in ``usage_audit``; successful calls with
``write_log=True`` also append full prompt/response to ``data/llm_usage_log.jsonl``.
Chat sends link ``conversation_id``, ``session_id``, ``interaction_id``, and
``message_id`` so the UI can roll up costs at each hierarchy level.
"""

from __future__ import annotations

import json
import logging
import sqlite3

import backend.config as _config
from backend.db import db_connection, execute_with_retry
from backend.init_db import http_details as _http_details

logger = logging.getLogger(__name__)


def insert_usage_audit(
    provider: str,
    model: str,
    prompt_tokens: int,
    response_tokens: int,
    input_cost: float,
    output_cost: float,
    time_taken: float,
    http_code: int,
    prompt_messages: list[dict[str, str]],
    response_content: str,
    router: str = "openrouter",
    write_log: bool = True,
    conversation_id: int | None = None,
    session_id: int | None = None,
    interaction_id: int | None = None,
    message_id: int | None = None,
    *,
    conn: sqlite3.Connection | None = None,
) -> int:
    if prompt_tokens < 0 or response_tokens < 0:
        raise ValueError("Token counts must be non-negative")
    if input_cost < 0 or output_cost < 0:
        raise ValueError("Costs must be non-negative")
    if time_taken < 0:
        raise ValueError("time_taken must be non-negative")

    details = _http_details(http_code)

    def _insert(connection: sqlite3.Connection) -> int:
        cursor = execute_with_retry(
            connection,
            """
            INSERT INTO usage_audit
                (router, provider, model, prompt_tokens, response_tokens,
                 input_cost, output_cost, time_taken, http_code, http_details,
                 conversation_id, session_id, interaction_id, message_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                router,
                provider,
                model,
                prompt_tokens,
                response_tokens,
                input_cost,
                output_cost,
                time_taken,
                http_code,
                details,
                conversation_id,
                session_id,
                interaction_id,
                message_id,
            ),
        )
        event_id: int = cursor.lastrowid  # type: ignore[assignment]
        execute_with_retry(
            connection,
            """
            INSERT INTO expense_log
                (event_id, conversation_id, session_id, interaction_id, message_id,
                 input_cost, output_cost)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                conversation_id,
                session_id,
                interaction_id,
                message_id,
                input_cost,
                output_cost,
            ),
        )
        return event_id

    if conn is not None:
        event_id = _insert(conn)
    else:
        with db_connection() as owned:
            event_id = _insert(owned)

    if write_log:
        _write_log_entry(event_id, prompt_messages, response_content)

    total = input_cost + output_cost
    logger.info(
        "Audit recorded: %s/%s — %d tokens — $%.8f total — %.2fs — HTTP %d (%s)",
        provider,
        model,
        prompt_tokens + response_tokens,
        total,
        time_taken,
        http_code,
        details,
    )

    return event_id


def _write_log_entry(
    event_id: int,
    prompt_messages: list[dict[str, str]],
    response_content: str,
) -> None:
    log_path = _config.LOG_PATH
    log_path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "event_id": event_id,
        "prompt_json": prompt_messages,
        "response_json": {"role": "assistant", "content": response_content},
    }
    with log_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
