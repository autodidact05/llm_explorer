"""SQLite access for the chat hierarchy (conversations → sessions → messages).

Keeps SQL out of HTTP routers; use cases orchestrate transactions and call these
helpers for reads/writes. Idempotent send responses are keyed by session +
``idempotency_key`` in ``chat_send_idempotency``.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from backend.db import db_connection, execute_with_retry


def create_conversation_and_session(
    *,
    system_message: str | None,
    user_id: int | None = None,
) -> dict[str, Any]:
    with db_connection() as conn:
        conv_cur = conn.execute(
            "INSERT INTO chat_conversations (title, system_message, user_id) VALUES (NULL, ?, ?)",
            [system_message, user_id],
        )
        conv_id = conv_cur.lastrowid
        cur = conn.execute(
            "INSERT INTO chat_sessions (title, conversation_id, user_id) VALUES (NULL, ?, ?)",
            [conv_id, user_id],
        )
        session_id = cur.lastrowid
        row = conn.execute(
            "SELECT id, title, status, created_at, ended_at, conversation_id "
            "FROM chat_sessions WHERE id = ?",
            [session_id],
        ).fetchone()
    return dict(row)


def restart_conversation_session(conv_id: int, *, user_id: int | None = None) -> dict[str, Any]:
    with db_connection() as conn:
        conv = conn.execute("SELECT id FROM chat_conversations WHERE id = ?", [conv_id]).fetchone()
        if not conv:
            return {}
        active = conn.execute(
            "SELECT id FROM chat_sessions WHERE conversation_id = ? AND status = 'active'",
            [conv_id],
        ).fetchone()
        if active:
            return {"error": "active_exists"}
        cur = conn.execute(
            "INSERT INTO chat_sessions (title, conversation_id, user_id) VALUES (NULL, ?, ?)",
            [conv_id, user_id],
        )
        session_id = cur.lastrowid
        row = conn.execute(
            "SELECT id, title, status, created_at, ended_at, conversation_id "
            "FROM chat_sessions WHERE id = ?",
            [session_id],
        ).fetchone()
    return dict(row) if row else {}


def search_conversations(
    *,
    q: str,
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    """Search conversation titles and message bodies (case-insensitive)."""
    term = q.strip()
    if not term:
        return list_conversations(page=page, page_size=page_size)

    like = f"%{term}%"
    offset = (page - 1) * page_size
    with db_connection() as conn:
        total = conn.execute(
            """
            SELECT COUNT(DISTINCT c.id)
            FROM chat_conversations c
            LEFT JOIN chat_sessions s ON s.conversation_id = c.id
            LEFT JOIN chat_messages m ON m.session_id = s.id
            WHERE c.title LIKE ? COLLATE NOCASE
               OR m.content LIKE ? COLLATE NOCASE
            """,
            [like, like],
        ).fetchone()[0]
        rows = conn.execute(
            """
            SELECT
                c.id, c.title, c.created_at,
                COUNT(DISTINCT s.id) AS session_count,
                COALESCE((
                    SELECT SUM(ua.input_cost + ua.output_cost)
                    FROM usage_audit ua
                    WHERE ua.conversation_id = c.id
                ), 0) AS total_cost,
                COUNT(m.id) FILTER (WHERE m.role = 'user') AS message_count,
                MAX(s.created_at) AS last_session_at,
                CASE WHEN EXISTS(
                    SELECT 1 FROM chat_sessions ss
                    WHERE ss.conversation_id = c.id AND ss.status = 'active'
                ) THEN 'active' ELSE 'ended' END AS status
            FROM chat_conversations c
            LEFT JOIN chat_sessions s ON s.conversation_id = c.id
            LEFT JOIN chat_messages m ON m.session_id = s.id
            WHERE c.title LIKE ? COLLATE NOCASE
               OR m.content LIKE ? COLLATE NOCASE
            GROUP BY c.id
            ORDER BY c.created_at DESC
            LIMIT ? OFFSET ?
            """,
            [like, like, page_size, offset],
        ).fetchall()
    return {"total": total, "page": page, "page_size": page_size, "items": [dict(r) for r in rows]}


def list_conversations(*, page: int, page_size: int) -> dict[str, Any]:
    offset = (page - 1) * page_size
    with db_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM chat_conversations").fetchone()[0]
        rows = conn.execute(
            """
            SELECT
                c.id, c.title, c.created_at,
                COUNT(DISTINCT s.id) AS session_count,
                COALESCE((
                    SELECT SUM(ua.input_cost + ua.output_cost)
                    FROM usage_audit ua
                    WHERE ua.conversation_id = c.id
                ), 0) AS total_cost,
                COUNT(m.id) FILTER (WHERE m.role = 'user') AS message_count,
                MAX(s.created_at) AS last_session_at,
                CASE WHEN EXISTS(
                    SELECT 1 FROM chat_sessions ss
                    WHERE ss.conversation_id = c.id AND ss.status = 'active'
                ) THEN 'active' ELSE 'ended' END AS status
            FROM chat_conversations c
            LEFT JOIN chat_sessions  s ON s.conversation_id = c.id
            LEFT JOIN chat_messages  m ON m.session_id = s.id
            GROUP BY c.id
            ORDER BY c.created_at DESC
            LIMIT ? OFFSET ?
            """,
            [page_size, offset],
        ).fetchall()
    return {"total": total, "page": page, "page_size": page_size, "items": [dict(r) for r in rows]}


def rename_conversation(conv_id: int, title: str) -> bool:
    with db_connection() as conn:
        conv = conn.execute("SELECT id FROM chat_conversations WHERE id = ?", [conv_id]).fetchone()
        if not conv:
            return False
        conn.execute("UPDATE chat_conversations SET title = ? WHERE id = ?", [title, conv_id])
    return True


def get_conversation_detail(conv_id: int) -> dict[str, Any] | None:
    with db_connection() as conn:
        conv = conn.execute(
            "SELECT id, title, created_at FROM chat_conversations WHERE id = ?",
            [conv_id],
        ).fetchone()
        if not conv:
            return None
        sessions = conn.execute(
            """
            SELECT s.id, s.title, s.status, s.created_at, s.ended_at,
                   COUNT(m.id) FILTER (WHERE m.role = 'user') AS message_count,
                   COALESCE((
                       SELECT SUM(ua.input_cost + ua.output_cost)
                       FROM usage_audit ua
                       WHERE ua.session_id = s.id
                   ), 0) AS total_cost
            FROM chat_sessions s
            LEFT JOIN chat_messages m ON m.session_id = s.id
            WHERE s.conversation_id = ?
            GROUP BY s.id
            ORDER BY s.created_at
            """,
            [conv_id],
        ).fetchall()
    sessions_list = [dict(s) for s in sessions]
    total_cost = sum(float(s["total_cost"]) for s in sessions_list)
    return {**dict(conv), "total_cost": total_cost, "sessions": sessions_list}


def list_sessions(
    *,
    status: str | None,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    offset = (page - 1) * page_size
    if status == "active":
        sql = """
            SELECT s.id, s.title, s.status, s.created_at, s.ended_at,
                   COUNT(m.id) FILTER (WHERE m.role = 'user') AS message_count,
                   COALESCE((
                       SELECT SUM(ua.input_cost + ua.output_cost)
                       FROM usage_audit ua WHERE ua.session_id = s.id
                   ), 0) AS total_cost
            FROM chat_sessions s
            LEFT JOIN chat_messages m ON m.session_id = s.id
            WHERE s.status = 'active'
            GROUP BY s.id ORDER BY s.created_at DESC LIMIT ? OFFSET ?
        """
        count_sql = "SELECT COUNT(*) FROM chat_sessions s WHERE s.status = 'active'"
        params: list[Any] = [page_size, offset]
        count_params: list[Any] = []
    elif status == "ended":
        sql = """
            SELECT s.id, s.title, s.status, s.created_at, s.ended_at,
                   COUNT(m.id) FILTER (WHERE m.role = 'user') AS message_count,
                   COALESCE((
                       SELECT SUM(ua.input_cost + ua.output_cost)
                       FROM usage_audit ua WHERE ua.session_id = s.id
                   ), 0) AS total_cost
            FROM chat_sessions s
            LEFT JOIN chat_messages m ON m.session_id = s.id
            WHERE s.status = 'ended'
            GROUP BY s.id ORDER BY s.created_at DESC LIMIT ? OFFSET ?
        """
        count_sql = "SELECT COUNT(*) FROM chat_sessions s WHERE s.status = 'ended'"
        params = [page_size, offset]
        count_params = []
    else:
        sql = """
            SELECT s.id, s.title, s.status, s.created_at, s.ended_at,
                   COUNT(m.id) FILTER (WHERE m.role = 'user') AS message_count,
                   COALESCE((
                       SELECT SUM(ua.input_cost + ua.output_cost)
                       FROM usage_audit ua WHERE ua.session_id = s.id
                   ), 0) AS total_cost
            FROM chat_sessions s
            LEFT JOIN chat_messages m ON m.session_id = s.id
            GROUP BY s.id ORDER BY s.created_at DESC LIMIT ? OFFSET ?
        """
        count_sql = "SELECT COUNT(*) FROM chat_sessions s"
        params = [page_size, offset]
        count_params = []

    with db_connection() as conn:
        total = conn.execute(count_sql, count_params).fetchone()[0]
        rows = conn.execute(sql, params).fetchall()
    return {"total": total, "page": page, "page_size": page_size, "items": [dict(r) for r in rows]}


def get_session_detail(session_id: int) -> dict[str, Any] | None:
    with db_connection() as conn:
        session = conn.execute(
            """
            SELECT id, title, status, created_at, ended_at, conversation_id,
                   COALESCE(active_branch_id, 1) AS active_branch_id
            FROM chat_sessions WHERE id = ?
            """,
            [session_id],
        ).fetchone()
        if not session:
            return None
        active_branch_id = int(session["active_branch_id"] or 1)
        messages = conn.execute(
            f"""
            SELECT m.id, m.role, m.content, m.model, m.provider,
                   m.event_id, m.interaction_id, m.created_at, m.branch_id,
                   u.prompt_tokens, u.response_tokens,
                   u.input_cost, u.output_cost, u.time_taken, u.http_code,
                   rr.rating AS response_rating
            FROM chat_messages m
            LEFT JOIN usage_audit u ON u.event_id = m.event_id
            LEFT JOIN response_ratings rr ON rr.message_id = m.id
            JOIN chat_sessions s ON s.id = m.session_id
            WHERE m.session_id = ?
            {_branch_filter_sql()}
            ORDER BY m.created_at
            """,
            [
                session_id,
                session_id,
                active_branch_id,
                active_branch_id,
                active_branch_id,
                active_branch_id,
            ],
        ).fetchall()
        total_cost = conn.execute(
            "SELECT COALESCE(SUM(input_cost + output_cost), 0) FROM usage_audit WHERE session_id = ?",
            [session_id],
        ).fetchone()[0]
        router_stats_row = conn.execute(
            """
            SELECT COUNT(*) AS router_calls,
                   COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0) AS router_tokens,
                   COALESCE(SUM(u.input_cost + u.output_cost), 0) AS router_cost
            FROM routing_logs rl
            JOIN usage_audit u ON u.event_id = rl.router_event_id
            WHERE rl.session_id = ?
            """,
            [session_id],
        ).fetchone()
        interactions = conn.execute(
            """
            SELECT ci.id, ci.provider, ci.model, ci.created_at,
                   ci.routed_by, ci.routing_reason,
                   ci.router_estimated_cost, ci.router_confidence,
                   COUNT(m.id) FILTER (WHERE m.role = 'user') AS message_count,
                   COALESCE(SUM(u.input_cost + u.output_cost), 0) AS total_cost,
                   COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0) AS total_tokens,
                   COALESCE(AVG(u.time_taken), 0) AS avg_time_taken,
                   rr.rating, rr.comment AS rating_comment
            FROM chat_interactions ci
            LEFT JOIN chat_messages m ON m.interaction_id = ci.id
            LEFT JOIN usage_audit u ON u.event_id = m.event_id
            LEFT JOIN routing_ratings rr ON rr.interaction_id = ci.id
            WHERE ci.session_id = ?
            GROUP BY ci.id ORDER BY ci.created_at
            """,
            [session_id],
        ).fetchall()
        conv_id = session["conversation_id"]
        prior_messages = (
            conn.execute(
                """
                SELECT m.id, m.role, m.content, m.model, m.provider,
                       m.event_id, m.interaction_id, m.created_at,
                       u.prompt_tokens, u.response_tokens,
                       u.input_cost, u.output_cost, u.time_taken, u.http_code,
                       rr.rating AS response_rating
                FROM chat_messages m
                JOIN chat_sessions s ON s.id = m.session_id
                LEFT JOIN usage_audit u ON u.event_id = m.event_id
                LEFT JOIN response_ratings rr ON rr.message_id = m.id
                WHERE s.conversation_id = ? AND m.session_id != ?
                ORDER BY m.created_at
                """,
                [conv_id, session_id],
            ).fetchall()
            if conv_id
            else []
        )
    return {
        **dict(session),
        "total_cost": float(total_cost),
        "router_stats": {
            "calls": int(router_stats_row["router_calls"]),
            "tokens": int(router_stats_row["router_tokens"]),
            "cost": float(router_stats_row["router_cost"]),
        },
        "messages": [dict(m) for m in messages],
        "prior_messages": [dict(m) for m in prior_messages],
        "interactions": [dict(i) for i in interactions],
        "branches": list_branches(session_id),
        "active_branch_id": active_branch_id,
    }


def get_session_for_send(session_id: int) -> sqlite3.Row | None:
    with db_connection() as conn:
        return conn.execute(
            """
            SELECT id, status, title, conversation_id,
                   COALESCE(active_branch_id, 1) AS active_branch_id
            FROM chat_sessions WHERE id = ?
            """,
            [session_id],
        ).fetchone()


def _branch_filter_sql() -> str:
    return """
        AND (
            s.id != ?
            OR (
                ? = 1 AND m.branch_id = 1
                OR (
                    ? != 1 AND (
                        m.id <= COALESCE(
                            (SELECT fork_message_id FROM chat_branches
                             WHERE id = ? AND session_id = s.id),
                            0
                        )
                        OR m.branch_id = ?
                    )
                )
            )
        )
    """


def load_conversation_history(
    *,
    conv_id: int | None,
    session_id: int,
    active_branch_id: int = 1,
) -> list[sqlite3.Row]:
    with db_connection() as conn:
        if conv_id:
            return conn.execute(
                f"""
                SELECT m.role, m.content
                FROM chat_messages m
                JOIN chat_sessions s ON s.id = m.session_id
                WHERE s.conversation_id = ?
                {_branch_filter_sql()}
                ORDER BY m.created_at
                """,
                [
                    conv_id,
                    session_id,
                    active_branch_id,
                    active_branch_id,
                    active_branch_id,
                    active_branch_id,
                ],
            ).fetchall()
        branch_clause = (
            "AND (branch_id = 1)"
            if active_branch_id == 1
            else """
            AND (
                id <= COALESCE(
                    (SELECT fork_message_id FROM chat_branches
                     WHERE id = ? AND session_id = ?),
                    0
                )
                OR branch_id = ?
            )
            """
        )
        params: list[Any] = [session_id]
        if active_branch_id != 1:
            params.extend([active_branch_id, session_id, active_branch_id])
        return conn.execute(
            f"SELECT role, content FROM chat_messages WHERE session_id = ? {branch_clause} ORDER BY created_at",
            params,
        ).fetchall()


def list_branches(session_id: int) -> list[dict[str, Any]]:
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, fork_message_id, label, created_at
            FROM chat_branches
            WHERE session_id = ?
            ORDER BY id
            """,
            [session_id],
        ).fetchall()
    branches = [{"id": 1, "fork_message_id": None, "label": "Main", "created_at": None}]
    branches.extend(dict(r) for r in rows)
    return branches


def create_branch(*, session_id: int, fork_message_id: int) -> dict[str, Any] | None:
    with db_connection() as conn:
        session = conn.execute(
            "SELECT id, status FROM chat_sessions WHERE id = ?",
            [session_id],
        ).fetchone()
        if not session or session["status"] != "active":
            return None
        msg = conn.execute(
            "SELECT id FROM chat_messages WHERE id = ? AND session_id = ?",
            [fork_message_id, session_id],
        ).fetchone()
        if not msg:
            return {"error": "message_not_found"}
        count = conn.execute(
            "SELECT COUNT(*) FROM chat_branches WHERE session_id = ?",
            [session_id],
        ).fetchone()[0]
        label = f"Branch {int(count) + 2}"
        cur = conn.execute(
            """
            INSERT INTO chat_branches (session_id, fork_message_id, label)
            VALUES (?, ?, ?)
            """,
            [session_id, fork_message_id, label],
        )
        branch_id = int(cur.lastrowid)
        conn.execute(
            "UPDATE chat_sessions SET active_branch_id = ? WHERE id = ?",
            [branch_id, session_id],
        )
    return {"branch_id": branch_id, "label": label, "fork_message_id": fork_message_id}


def set_active_branch(session_id: int, branch_id: int) -> dict[str, Any] | None:
    with db_connection() as conn:
        session = conn.execute(
            "SELECT id FROM chat_sessions WHERE id = ?",
            [session_id],
        ).fetchone()
        if not session:
            return None
        if branch_id != 1:
            row = conn.execute(
                "SELECT id FROM chat_branches WHERE id = ? AND session_id = ?",
                [branch_id, session_id],
            ).fetchone()
            if not row:
                return {"error": "branch_not_found"}
        conn.execute(
            "UPDATE chat_sessions SET active_branch_id = ? WHERE id = ?",
            [branch_id, session_id],
        )
    return {"active_branch_id": branch_id}


def get_conversation_system_message(conv_id: int | None) -> str | None:
    if not conv_id:
        return None
    with db_connection() as conn:
        row = conn.execute(
            "SELECT system_message FROM chat_conversations WHERE id = ?",
            [conv_id],
        ).fetchone()
    return str(row["system_message"]) if row and row["system_message"] else None


def end_session(session_id: int) -> dict[str, Any] | None:
    with db_connection() as conn:
        session = conn.execute(
            "SELECT id, status FROM chat_sessions WHERE id = ?",
            [session_id],
        ).fetchone()
        if not session:
            return None
        if session["status"] != "active":
            return {"error": "already_ended"}
        conn.execute(
            "UPDATE chat_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?",
            [session_id],
        )
        summary = conn.execute(
            """
            SELECT COUNT(m.id) FILTER (WHERE m.role = 'user') AS message_count,
                   COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0) AS total_tokens
            FROM chat_messages m
            LEFT JOIN usage_audit u ON u.event_id = m.event_id
            WHERE m.session_id = ?
            """,
            [session_id],
        ).fetchone()
        total_cost = conn.execute(
            "SELECT COALESCE(SUM(input_cost + output_cost), 0) FROM usage_audit WHERE session_id = ?",
            [session_id],
        ).fetchone()[0]
    return {
        "status": "ended",
        "message_count": summary["message_count"],
        "total_cost": float(total_cost),
        "total_tokens": summary["total_tokens"],
    }


def delete_session(session_id: int) -> dict[str, Any] | None:
    with db_connection() as conn:
        session = conn.execute(
            "SELECT id, status FROM chat_sessions WHERE id = ?",
            [session_id],
        ).fetchone()
        if not session:
            return None
        if session["status"] == "active":
            return {"error": "still_active"}
        conn.execute("DELETE FROM chat_sessions WHERE id = ?", [session_id])
    return {"deleted": True, "id": session_id}


def get_idempotent_response(session_id: int, idempotency_key: str) -> dict[str, Any] | None:
    with db_connection() as conn:
        row = conn.execute(
            "SELECT response_json FROM chat_send_idempotency WHERE session_id = ? AND idempotency_key = ?",
            [session_id, idempotency_key],
        ).fetchone()
    if not row:
        return None
    return json.loads(str(row["response_json"]))


def store_idempotent_response(
    session_id: int,
    idempotency_key: str,
    response: dict[str, Any],
) -> None:
    with db_connection() as conn:
        execute_with_retry(
            conn,
            """
            INSERT OR REPLACE INTO chat_send_idempotency
                (session_id, idempotency_key, response_json)
            VALUES (?, ?, ?)
            """,
            [session_id, idempotency_key, json.dumps(response)],
        )
