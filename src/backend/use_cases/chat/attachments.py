from __future__ import annotations

import base64
import logging
from datetime import datetime
from typing import Any

import backend.config as _config

logger = logging.getLogger(__name__)

MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024
MAX_TEXT_ATTACHMENT_CHARS = 20_000


def save_attachments(*, session_id: int, attachments: list[dict[str, Any]]) -> None:
    upload_dir = _config.UPLOADED_DATA_PATH
    upload_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    for att in attachments:
        name = str(att.get("name") or "")
        data = str(att.get("data") or "")
        safe_name = name.replace("/", "_").replace("\\", "_")
        dest = upload_dir / f"s{session_id}_{ts}_{safe_name}"
        try:
            raw = base64.b64decode(data)
        except (ValueError, TypeError):
            logger.warning("Failed to decode attachment %s (bad base64)", name)
            continue
        if len(raw) > MAX_ATTACHMENT_BYTES:
            logger.warning("Skipping attachment %s: %d bytes exceeds limit", name, len(raw))
            continue
        try:
            dest.write_bytes(raw)
        except OSError as exc:
            logger.warning("Failed to save attachment %s: %s", name, exc)


def build_user_message(
    *,
    content: str,
    attachments: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    if not attachments:
        return {"role": "user", "content": content}

    user_content: list[dict[str, Any]] = [{"type": "text", "text": content}]
    for att in attachments:
        name = str(att.get("name") or "")
        mime_type = str(att.get("mime_type") or "application/octet-stream")
        b64 = str(att.get("data") or "")

        try:
            raw = base64.b64decode(b64)
        except (ValueError, TypeError):
            user_content.append(
                {"type": "text", "text": f"\n[Attached file: {name}] (invalid base64)"}
            )
            continue

        if len(raw) > MAX_ATTACHMENT_BYTES:
            user_content.append(
                {
                    "type": "text",
                    "text": f"\n[Attached file: {name}] (skipped; too large: {len(raw)} bytes)",
                }
            )
            continue

        if mime_type.startswith("image/"):
            user_content.append(
                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}}
            )
        else:
            decoded = raw.decode("utf-8", errors="replace")
            if len(decoded) > MAX_TEXT_ATTACHMENT_CHARS:
                decoded = decoded[:MAX_TEXT_ATTACHMENT_CHARS] + "\n…(truncated)…"
            user_content.append(
                {"type": "text", "text": f"\n[Attached file: {name}]\n{decoded}"}
            )
    return {"role": "user", "content": user_content}
