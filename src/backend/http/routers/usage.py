from __future__ import annotations

import csv
import io
import json
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from backend.db import db_connection

router = APIRouter()

_AUDIT_EXPORT_COLUMNS = (
    "event_id",
    "created_at",
    "router",
    "provider",
    "model",
    "prompt_tokens",
    "response_tokens",
    "input_cost",
    "output_cost",
    "time_taken",
    "http_code",
    "conversation_id",
    "session_id",
    "interaction_id",
    "message_id",
)


@router.get("/api/usage")
def list_usage(
    provider: str | None = None,
    model: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    conds: list[str] = []
    params: list[Any] = []

    if provider:
        conds.append("provider = ?")
        params.append(provider)
    if model:
        conds.append("model = ?")
        params.append(model)

    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    offset = (page - 1) * page_size

    with db_connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM usage_audit {where}", params).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT event_id, created_at, router, provider, model,
                   prompt_tokens, response_tokens, input_cost, output_cost,
                   time_taken, http_code
            FROM usage_audit {where}
            ORDER BY created_at DESC LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [dict(r) for r in rows],
    }


@router.get("/api/usage/conversations")
def list_usage_conversations(page: int = 1, page_size: int = 20) -> dict[str, Any]:
    offset = (page - 1) * page_size
    with db_connection() as conn:
        total = conn.execute(
            "SELECT COUNT(DISTINCT conversation_id) FROM usage_audit WHERE conversation_id IS NOT NULL"
        ).fetchone()[0]
        rows = conn.execute(
            """
            SELECT
                ua.conversation_id,
                c.title AS conversation_title,
                MIN(ua.created_at) AS first_event,
                MAX(ua.created_at) AS last_event,
                COUNT(*) AS event_count,
                COALESCE(SUM(ua.input_cost + ua.output_cost), 0) AS total_cost,
                COALESCE(SUM(CASE WHEN ua.interaction_id IS NULL
                    THEN ua.input_cost + ua.output_cost ELSE 0 END), 0) AS router_cost,
                COALESCE(SUM(CASE WHEN ua.interaction_id IS NOT NULL
                    THEN ua.input_cost + ua.output_cost ELSE 0 END), 0) AS answering_cost
            FROM usage_audit ua
            LEFT JOIN chat_conversations c ON c.id = ua.conversation_id
            WHERE ua.conversation_id IS NOT NULL
            GROUP BY ua.conversation_id
            ORDER BY MAX(ua.created_at) DESC
            LIMIT ? OFFSET ?
            """,
            [page_size, offset],
        ).fetchall()
        direct = conn.execute(
            """SELECT COUNT(*), COALESCE(SUM(input_cost + output_cost), 0)
               FROM usage_audit WHERE conversation_id IS NULL"""
        ).fetchone()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [dict(r) for r in rows],
        "direct_calls_count": int(direct[0]),
        "direct_calls_cost": float(direct[1]),
    }


@router.get("/api/usage/conversations/{conv_id}/sessions")
def list_usage_sessions_for_conversation(conv_id: int) -> dict[str, Any]:
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                ua.session_id,
                s.title AS session_title,
                s.status,
                MIN(ua.created_at) AS first_event,
                MAX(ua.created_at) AS last_event,
                COUNT(*) AS event_count,
                COALESCE(SUM(ua.input_cost + ua.output_cost), 0) AS total_cost,
                COALESCE(SUM(CASE WHEN ua.interaction_id IS NULL
                    THEN ua.input_cost + ua.output_cost ELSE 0 END), 0) AS router_cost,
                COALESCE(SUM(CASE WHEN ua.interaction_id IS NOT NULL
                    THEN ua.input_cost + ua.output_cost ELSE 0 END), 0) AS answering_cost
            FROM usage_audit ua
            LEFT JOIN chat_sessions s ON s.id = ua.session_id
            WHERE ua.conversation_id = ? AND ua.session_id IS NOT NULL
            GROUP BY ua.session_id
            ORDER BY MIN(ua.created_at)
            """,
            [conv_id],
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/api/usage/sessions/{session_id}/interactions")
def list_usage_interactions_for_session(session_id: int) -> dict[str, Any]:
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                ci.id AS interaction_id,
                ci.provider,
                ci.model,
                ci.created_at,
                ci.routed_by,
                COUNT(DISTINCT m.id) FILTER (WHERE m.role = 'assistant') AS message_count,
                COALESCE(SUM(ua.input_cost + ua.output_cost), 0) AS answering_cost,
                COALESCE((
                    SELECT SUM(rua.input_cost + rua.output_cost)
                    FROM routing_logs rl
                    JOIN usage_audit rua ON rua.event_id = rl.router_event_id
                    JOIN chat_messages m2 ON m2.id = rl.message_id
                    WHERE m2.interaction_id = ci.id
                ), 0) AS router_cost
            FROM chat_interactions ci
            LEFT JOIN chat_messages m ON m.interaction_id = ci.id
            LEFT JOIN usage_audit ua ON ua.interaction_id = ci.id
            WHERE ci.session_id = ?
            GROUP BY ci.id
            ORDER BY ci.created_at
            """,
            [session_id],
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/api/usage/interactions/{interaction_id}/messages")
def list_usage_messages_for_interaction(interaction_id: int) -> dict[str, Any]:
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                m.id AS message_id,
                m.created_at,
                m.provider,
                m.model,
                COALESCE(ua.prompt_tokens, 0) AS prompt_tokens,
                COALESCE(ua.response_tokens, 0) AS response_tokens,
                COALESCE(ua.input_cost + ua.output_cost, 0) AS answering_cost,
                COALESCE((
                    SELECT rua.input_cost + rua.output_cost
                    FROM routing_logs rl
                    JOIN usage_audit rua ON rua.event_id = rl.router_event_id
                    WHERE rl.message_id = m.id
                ), 0) AS router_cost,
                COALESCE(ua.time_taken, 0) AS time_taken,
                ua.http_code
            FROM chat_messages m
            LEFT JOIN usage_audit ua ON ua.event_id = m.event_id
            WHERE m.interaction_id = ? AND m.role = 'assistant'
            ORDER BY m.created_at
            """,
            [interaction_id],
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/api/usage/export")
def export_usage_audit(format: str = "json") -> Response:
    fmt = format.strip().lower()
    if fmt not in ("json", "csv"):
        raise HTTPException(400, "format must be json or csv")

    with db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT {", ".join(_AUDIT_EXPORT_COLUMNS)}
            FROM usage_audit
            ORDER BY created_at DESC
            """
        ).fetchall()

    items = [dict(r) for r in rows]

    if fmt == "json":
        body = json.dumps(items, indent=2)
        return Response(
            content=body,
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="usage_audit.json"'},
        )

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(_AUDIT_EXPORT_COLUMNS))
    writer.writeheader()
    for item in items:
        writer.writerow({k: item.get(k) for k in _AUDIT_EXPORT_COLUMNS})
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="usage_audit.csv"'},
    )

