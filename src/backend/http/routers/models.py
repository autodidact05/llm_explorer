from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.db import db_connection
from backend.use_cases import models_sync, startup
from backend.use_cases.groq_models import sync_groq_models
from backend.use_cases.llm_routing import catalog_sql_clause

router = APIRouter()


@router.get("/api/models")
def list_models(
    provider: str | None = None,
    category: str | None = None,
    status: str | None = None,
    is_local: int | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    conds: list[str] = []
    params: list[Any] = []

    catalog_clause, catalog_params = catalog_sql_clause()
    conds.append(catalog_clause)
    params.extend(catalog_params)

    if provider:
        conds.append("provider = ?")
        params.append(provider)
    if category:
        conds.append("category = ?")
        params.append(category)
    if status:
        conds.append("status = ?")
        params.append(status)
    if is_local is not None:
        conds.append("is_local = ?")
        params.append(is_local)
    if search:
        conds.append("(provider LIKE ? OR model LIKE ? OR description LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like, like])

    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    offset = (page - 1) * page_size

    with db_connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM model_pricing {where}", params).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT router, provider, model, category, description,
                   context_length, input_per_million, output_per_million,
                   last_updated, status, is_local, sync_source
            FROM model_pricing {where}
            ORDER BY provider, model
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [dict(r) for r in rows],
    }


@router.get("/api/models/providers")
def list_providers() -> list[str]:
    catalog_clause, catalog_params = catalog_sql_clause()
    with db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT DISTINCT provider FROM model_pricing
            WHERE status = 'active' AND {catalog_clause}
            ORDER BY provider
            """,
            catalog_params,
        ).fetchall()
    return [r[0] for r in rows]


@router.get("/api/models/categories")
def list_categories() -> list[str]:
    catalog_clause, catalog_params = catalog_sql_clause()
    with db_connection() as conn:
        rows = conn.execute(
            f"""SELECT DISTINCT category FROM model_pricing
               WHERE status = 'active' AND category IS NOT NULL AND {catalog_clause}
               ORDER BY category""",
            catalog_params,
        ).fetchall()
    return [r[0] for r in rows]


@router.get("/api/models/stats")
def get_model_stats() -> dict[str, Any]:
    catalog_clause, catalog_params = catalog_sql_clause()
    with db_connection() as conn:
        router_counts = conn.execute(
            f"""
            SELECT router, COUNT(*) as count
            FROM model_pricing
            WHERE status = 'active' AND {catalog_clause}
            GROUP BY router
            """,
            catalog_params,
        ).fetchall()
        last_updated = conn.execute(
            f"""
            SELECT MAX(last_updated) FROM model_pricing
            WHERE status = 'active' AND {catalog_clause}
            """,
            catalog_params,
        ).fetchone()[0]
    return {
        "counts": {r["router"]: r["count"] for r in router_counts},
        "last_updated": last_updated,
    }


class SyncRequest(BaseModel):
    source: str = "openrouter"


@router.post("/api/models/sync")
def sync_models(req: SyncRequest) -> dict[str, str]:
    if req.source not in ("openrouter", "local", "groq"):
        raise HTTPException(400, "source must be 'openrouter', 'local', or 'groq'")

    if req.source == "groq":
        try:
            output = sync_groq_models()
        except Exception as exc:
            raise HTTPException(500, str(exc)) from exc
        return {"output": output, "stderr": ""}

    api_key = None
    if req.source == "openrouter":
        api_key = startup.get_active_api_key_or_none()
        if not api_key:
            raise HTTPException(400, "No API key configured. Add one in Settings.")

    try:
        output, stderr = models_sync.sync_openrouter_models(source=req.source, api_key=api_key)  # type: ignore[arg-type]
    except FileNotFoundError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc

    return {"output": output, "stderr": stderr}
