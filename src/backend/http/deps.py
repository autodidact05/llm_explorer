from __future__ import annotations

from fastapi import HTTPException, Request


def get_user_id(request: Request) -> int:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(401, "Not authenticated")
    return int(user_id)
