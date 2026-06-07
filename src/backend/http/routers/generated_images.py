from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

import backend.config as _config

router = APIRouter()


@router.get("/api/generated-images/{filename}")
def get_generated_image(filename: str, request: Request) -> FileResponse:
    if getattr(request.state, "user_id", None) is None:
        raise HTTPException(401, "Not authenticated")
    safe = Path(filename).name
    if safe != filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")
    path = _config.GENERATED_IMAGES_PATH / safe
    if not path.is_file():
        raise HTTPException(404, "Image not found")
    return FileResponse(path, media_type="image/png")
