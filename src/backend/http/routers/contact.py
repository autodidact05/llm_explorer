"""Contact / feedback form submissions."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend.http.deps import get_user_id
from backend.repos import contact_repo

router = APIRouter()


class ContactSubmitRequest(BaseModel):
    subject: str = Field(..., min_length=1, max_length=200)
    message: str = Field(..., min_length=1, max_length=10000)
    rating: int = Field(..., ge=1, le=5)


@router.post("/api/contact")
def submit_contact(request: Request, body: ContactSubmitRequest) -> dict[str, Any]:
    user_id = get_user_id(request)
    user_email = getattr(request.state, "user_email", None) or None
    if user_email == "":
        user_email = None

    subject = body.subject.strip()
    message = body.message.strip()
    if not subject or not message:
        raise HTTPException(400, "Subject and message cannot be empty")

    row = contact_repo.insert_contact_submission(
        subject=subject,
        message=message,
        rating=body.rating,
        user_id=user_id,
        user_email=user_email,
    )
    return {
        "id": row["id"],
        "status": "received",
        "message": "Thank you — your message has been saved.",
        "created_at": row["created_at"],
    }
