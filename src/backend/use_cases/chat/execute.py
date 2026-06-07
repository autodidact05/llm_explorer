"""Run the answering LLM or image-generation call for a prepared chat send."""

from __future__ import annotations

import base64
import concurrent.futures
from datetime import datetime
from typing import Any

import backend.config as _config
from backend.chat_timeouts import IMAGE_GENERATION_TIMEOUT_SEC
from backend.image_service import invoke_image_generation
from backend.llm_common import LLMCallError
from backend.llm_types import LLMRunResult
from backend.use_cases.answering_agent import invoke_answering_agent
from backend.use_cases.chat.types import PreparedChatSend


def execute_image_sync(prepared: PreparedChatSend) -> tuple[LLMRunResult, str | None]:
    image_url: str | None = None
    raw = invoke_image_generation(
        provider=prepared.actual_provider,
        model=prepared.actual_model,
        prompt=prepared.content,
    )
    b64_data = str(raw.get("image_b64") or "")
    if b64_data:
        try:
            raw_image = base64.b64decode(b64_data)
            _config.GENERATED_IMAGES_PATH.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            image_filename = f"s{prepared.session_id}_{ts}.png"
            (_config.GENERATED_IMAGES_PATH / image_filename).write_bytes(raw_image)
            image_url = f"/api/generated-images/{image_filename}"
        except Exception:
            pass
    run = LLMRunResult(
        content="",
        prompt_tokens=int(raw.get("prompt_tokens", 0)),
        response_tokens=int(raw.get("response_tokens", 0)),
        input_cost=float(raw.get("input_cost", 0)),
        output_cost=float(raw.get("output_cost", 0)),
        time_taken=float(raw.get("time_taken", 0)),
        http_code=int(raw.get("http_code", 200)),
        prompt_messages=prepared.audit_messages,
        response_content="",
    )
    return run, image_url


def execute_chat_model(prepared: PreparedChatSend) -> tuple[LLMRunResult, str | None]:
    if prepared.is_image_gen:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(execute_image_sync, prepared)
            try:
                return future.result(timeout=IMAGE_GENERATION_TIMEOUT_SEC)
            except concurrent.futures.TimeoutError as exc:
                raise LLMCallError(
                    f"Image generation timed out after {int(IMAGE_GENERATION_TIMEOUT_SEC)}s",
                    504,
                    IMAGE_GENERATION_TIMEOUT_SEC,
                ) from exc

    result_dict = invoke_answering_agent(
        provider=prepared.actual_provider,
        model=prepared.actual_model,
        messages=prepared.llm_messages,
    )
    run = LLMRunResult.from_usage_dict(
        usage=result_dict,
        content=str(result_dict["content"]),
        prompt_messages=prepared.audit_messages,
    )
    return run, None
