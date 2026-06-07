from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.http.deps import get_user_id
from backend.repos import chat_repo
from backend.use_cases import chat as chat_uc
from backend.use_cases.cost_estimate import estimate_chat_cost
from backend.use_cases.groq_models import assert_groq_model_allowed

router = APIRouter()


class CreateSessionRequest(BaseModel):
    system_message: str | None = None


@router.post("/api/chat/sessions")
def create_chat_session(
    request: Request,
    req: CreateSessionRequest = Body(default=CreateSessionRequest()),
) -> dict[str, Any]:
    user_id = get_user_id(request)
    return chat_repo.create_conversation_and_session(
        system_message=req.system_message,
        user_id=user_id,
    )


@router.post("/api/chat/conversations/{conv_id}/sessions")
def restart_conversation(conv_id: int, request: Request) -> dict[str, Any]:
    user_id = get_user_id(request)
    row = chat_repo.restart_conversation_session(conv_id, user_id=user_id)
    if not row:
        raise HTTPException(404, "Conversation not found")
    if row.get("error") == "active_exists":
        raise HTTPException(400, "An active session already exists for this conversation")
    return row


@router.get("/api/chat/conversations")
def list_conversations(page: int = 1, page_size: int = 20) -> dict[str, Any]:
    return chat_repo.list_conversations(page=page, page_size=page_size)


@router.get("/api/chat/conversations/search")
def search_conversations(q: str, page: int = 1, page_size: int = 20) -> dict[str, Any]:
    return chat_repo.search_conversations(q=q, page=page, page_size=page_size)


class RenameConversationRequest(BaseModel):
    title: str


@router.patch("/api/chat/conversations/{conv_id}")
def rename_conversation(conv_id: int, body: RenameConversationRequest) -> dict[str, Any]:
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Title cannot be empty")
    if not chat_repo.rename_conversation(conv_id, title):
        raise HTTPException(404, "Conversation not found")
    return {"id": conv_id, "title": title}


@router.get("/api/chat/conversations/{conv_id}")
def get_conversation(conv_id: int) -> dict[str, Any]:
    detail = chat_repo.get_conversation_detail(conv_id)
    if not detail:
        raise HTTPException(404, "Conversation not found")
    return detail


@router.get("/api/chat/sessions")
def list_chat_sessions(
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    return chat_repo.list_sessions(status=status, page=page, page_size=page_size)


@router.get("/api/chat/sessions/{session_id}")
def get_chat_session(session_id: int) -> dict[str, Any]:
    detail = chat_repo.get_session_detail(session_id)
    if not detail:
        raise HTTPException(404, "Session not found")
    return detail


class Attachment(BaseModel):
    name: str
    mime_type: str
    data: str


class ChatMessageRequest(BaseModel):
    provider: str
    model: str
    content: str
    attachments: list[Attachment] | None = None
    use_router_llm: bool | None = None
    idempotency_key: str | None = None


class EstimateCostRequest(BaseModel):
    provider: str
    model: str
    content: str


@router.post("/api/chat/estimate-cost")
def estimate_message_cost(req: EstimateCostRequest) -> dict[str, Any]:
    assert_groq_model_allowed(provider=req.provider, model=req.model)
    return estimate_chat_cost(
        content=req.content,
        provider=req.provider,
        model=req.model,
    )


class CreateBranchRequest(BaseModel):
    fork_message_id: int


@router.get("/api/chat/sessions/{session_id}/branches")
def list_session_branches(session_id: int) -> dict[str, Any]:
    return {"items": chat_repo.list_branches(session_id)}


@router.post("/api/chat/sessions/{session_id}/branches")
def create_session_branch(session_id: int, body: CreateBranchRequest) -> dict[str, Any]:
    result = chat_repo.create_branch(
        session_id=session_id,
        fork_message_id=body.fork_message_id,
    )
    if result is None:
        raise HTTPException(404, "Session not found")
    if result.get("error"):
        raise HTTPException(400, result["error"])
    return result


class SetBranchRequest(BaseModel):
    branch_id: int


@router.patch("/api/chat/sessions/{session_id}/branches/active")
def set_active_branch(session_id: int, body: SetBranchRequest) -> dict[str, Any]:
    result = chat_repo.set_active_branch(session_id, body.branch_id)
    if result is None:
        raise HTTPException(404, "Session not found")
    if result.get("error"):
        raise HTTPException(400, result["error"])
    return result


@router.post("/api/chat/sessions/{session_id}/messages")
def send_chat_message(session_id: int, req: ChatMessageRequest) -> dict[str, Any]:
    return chat_uc.send_message(
        session_id=session_id,
        provider=req.provider,
        model=req.model,
        content=req.content,
        attachments=[a.model_dump() for a in req.attachments] if req.attachments else None,
        use_router_llm=req.use_router_llm,
        idempotency_key=req.idempotency_key,
    )


@router.post("/api/chat/sessions/{session_id}/messages/stream")
async def send_chat_message_stream(
    session_id: int,
    req: ChatMessageRequest,
    request: Request,
) -> StreamingResponse:
    async def event_generator():
        async def is_disconnected() -> bool:
            return await request.is_disconnected()

        async for event in chat_uc.iter_send_message_stream(
            session_id=session_id,
            provider=req.provider,
            model=req.model,
            content=req.content,
            attachments=[a.model_dump() for a in req.attachments] if req.attachments else None,
            use_router_llm=req.use_router_llm,
            idempotency_key=req.idempotency_key,
            is_disconnected=is_disconnected,
        ):
            if await request.is_disconnected():
                break
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/chat/sessions/{session_id}/end")
def end_chat_session(session_id: int) -> dict[str, Any]:
    result = chat_repo.end_session(session_id)
    if not result:
        raise HTTPException(404, "Session not found")
    if result.get("error") == "already_ended":
        raise HTTPException(400, "Session is already ended")
    return result


@router.delete("/api/chat/sessions/{session_id}")
def delete_chat_session(session_id: int) -> dict[str, Any]:
    result = chat_repo.delete_session(session_id)
    if not result:
        raise HTTPException(404, "Session not found")
    if result.get("error") == "still_active":
        raise HTTPException(400, "End the chat session before deleting it")
    return result


class MessageRatingCreate(BaseModel):
    rating: int
    comment: str | None = None


@router.post("/api/chat/messages/{message_id}/rating")
def rate_message(message_id: int, body: MessageRatingCreate) -> dict[str, Any]:
    if body.rating not in (1, 2, 3):
        raise HTTPException(400, "Rating must be 1, 2, or 3")
    from backend.db import db_connection

    with db_connection() as conn:
        msg = conn.execute(
            "SELECT id FROM chat_messages WHERE id = ?", [message_id]
        ).fetchone()
        if not msg:
            raise HTTPException(404, "Message not found")
        existing = conn.execute(
            "SELECT id FROM response_ratings WHERE message_id = ?", [message_id]
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE response_ratings SET rating = ?, comment = ? WHERE message_id = ?",
                [body.rating, body.comment, message_id],
            )
            rating_id = existing["id"]
        else:
            cur = conn.execute(
                "INSERT INTO response_ratings (message_id, rating, comment) VALUES (?, ?, ?)",
                [message_id, body.rating, body.comment],
            )
            rating_id = cur.lastrowid
    return {
        "id": rating_id,
        "message_id": message_id,
        "rating": body.rating,
        "comment": body.comment,
    }


class RoutingRatingCreate(BaseModel):
    rating: int
    comment: str | None = None


@router.post("/api/chat/interactions/{interaction_id}/rating")
def rate_interaction(interaction_id: int, body: RoutingRatingCreate) -> dict[str, Any]:
    if body.rating not in (1, 2, 3):
        raise HTTPException(400, "Rating must be 1, 2, or 3")
    from backend.db import db_connection

    with db_connection() as conn:
        intr = conn.execute(
            "SELECT id FROM chat_interactions WHERE id = ?",
            [interaction_id],
        ).fetchone()
        if not intr:
            raise HTTPException(404, "Interaction not found")
        existing = conn.execute(
            "SELECT id FROM routing_ratings WHERE interaction_id = ?",
            [interaction_id],
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE routing_ratings SET rating = ?, comment = ? WHERE interaction_id = ?",
                [body.rating, body.comment, interaction_id],
            )
            rating_id = existing["id"]
        else:
            cur = conn.execute(
                "INSERT INTO routing_ratings (interaction_id, rating, comment) VALUES (?, ?, ?)",
                [interaction_id, body.rating, body.comment],
            )
            rating_id = cur.lastrowid
    return {
        "id": rating_id,
        "interaction_id": interaction_id,
        "rating": body.rating,
        "comment": body.comment,
    }
