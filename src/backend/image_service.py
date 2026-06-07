from __future__ import annotations

import base64
import logging
import os
import re
import sqlite3
import time
import urllib.request

import httpx
from openai import OpenAI

import backend.config as _config
from backend.chat_timeouts import HTTP_CONNECT_TIMEOUT_SEC, IMAGE_GENERATION_TIMEOUT_SEC
from backend.llm_common import LLMCallError, calculate_cost, get_provider_api_key
from backend.pricing_service import get_model_pricing

logger = logging.getLogger(__name__)

_client_cache: dict[str, OpenAI] = {}


def _http_timeout() -> httpx.Timeout:
    return httpx.Timeout(IMAGE_GENERATION_TIMEOUT_SEC, connect=HTTP_CONNECT_TIMEOUT_SEC)

_SIZE_TO_ASPECT: dict[str, str] = {
    "1024x1024": "1:1",
    "832x1248": "2:3",
    "1248x832": "3:2",
    "864x1184": "3:4",
    "1184x864": "4:3",
    "896x1152": "4:5",
    "1152x896": "5:4",
    "768x1344": "9:16",
    "1344x768": "16:9",
    "1536x672": "21:9",
}


def reset_client() -> None:
    _client_cache.clear()


def _get_client(provider: str) -> OpenAI:
    resolved = "groq" if provider == "groq" else "openrouter"
    if resolved not in _client_cache:
        api_key = get_provider_api_key(resolved)
        base_url = _config.GROQ_BASE_URL if resolved == "groq" else _config.OPENROUTER_BASE_URL
        _client_cache[resolved] = OpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=_http_timeout(),
        )
    return _client_cache[resolved]


def _decode_image_url(url: str) -> str:
    """Return raw base64 payload from a data URL or remote image URL."""
    if url.startswith("data:"):
        if ";base64," in url:
            return url.split(";base64,", 1)[1]
        return ""
    if url.startswith("http://") or url.startswith("https://"):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "llm-explorer/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
                return base64.b64encode(resp.read()).decode()
        except Exception as exc:
            logger.warning("Failed to download generated image from URL: %s", exc)
    return ""


def _image_url_from_payload(img: object) -> str | None:
    if isinstance(img, dict):
        image_url = img.get("image_url") or img.get("imageUrl")
        if isinstance(image_url, dict):
            url = image_url.get("url")
            return str(url) if url else None
        return None
    image_url = getattr(img, "image_url", None) or getattr(img, "imageUrl", None)
    if image_url is None:
        return None
    url = getattr(image_url, "url", None)
    return str(url) if url else None


def _extract_image_b64_from_message(message: object) -> list[str]:
    """Extract base64 image payloads from an OpenRouter assistant message."""
    msg_dict = message.model_dump() if hasattr(message, "model_dump") else {}
    images = getattr(message, "images", None) or msg_dict.get("images") or []

    b64_list: list[str] = []
    for img in images:
        url = _image_url_from_payload(img)
        if not url:
            continue
        b64 = _decode_image_url(url)
        if b64:
            b64_list.append(b64)

    content = getattr(message, "content", None) or msg_dict.get("content") or ""
    if isinstance(content, str) and not b64_list:
        for match in re.finditer(r"data:image/[^;]+;base64,([A-Za-z0-9+/=]+)", content):
            b64_list.append(match.group(1))

    return b64_list


def invoke_image_generation(
    provider: str,
    model: str,
    prompt: str,
    size: str = "1024x1024",
) -> dict[str, object]:
    """Generate an image via OpenRouter chat completions (modalities API)."""
    if provider == "ollama":
        raise LLMCallError("Ollama does not support image generation", 400, 0.0)

    client = _get_client(provider)
    model_id = model if provider == "groq" else f"{provider}/{model}"

    extra_body: dict[str, object] = {"modalities": ["image", "text"]}
    aspect_ratio = _SIZE_TO_ASPECT.get(size)
    if aspect_ratio:
        extra_body["image_config"] = {"aspect_ratio": aspect_ratio}

    logger.info("Generating image with %s (size=%s), prompt: %.100s…", model_id, size, prompt)

    t0 = time.perf_counter()
    try:
        response = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": prompt}],
            extra_body=extra_body,
        )
    except Exception as exc:
        time_taken = time.perf_counter() - t0
        http_code = int(getattr(exc, "status_code", 500))

        body = str(exc)
        response_text: str = ""
        try:
            response_text = exc.response.text  # type: ignore[union-attr]
        except Exception:
            pass
        combined = body + response_text

        if (
            combined.lstrip().startswith("<")
            or "<!doctype" in combined[:500].lower()
            or "<html" in combined[:500].lower()
        ):
            body = (
                f"Image generation failed (HTTP {http_code}): the provider returned "
                f"an HTML error page. The model '{model_id}' may not support "
                f"image generation via this provider, or additional permissions are required."
            )
        logger.error("Image generation failed for %s (HTTP %d): %s", model_id, http_code, body[:300])
        raise LLMCallError(body, http_code, time_taken) from exc

    time_taken = time.perf_counter() - t0
    message = response.choices[0].message
    b64_list = _extract_image_b64_from_message(message)
    if not b64_list:
        text = getattr(message, "content", None) or ""
        detail = f" Model response: {str(text)[:200]}" if text else ""
        raise LLMCallError(
            f"Image generation returned no image data.{detail}",
            502,
            time_taken,
        )

    b64 = b64_list[0]
    text_content = getattr(message, "content", None) or ""
    revised_prompt = str(text_content).strip() or prompt

    usage = response.usage
    prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    response_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
    try:
        input_per_million, output_per_million = get_model_pricing(provider, model)
        input_cost = calculate_cost(prompt_tokens, input_per_million)
        output_cost = calculate_cost(response_tokens, output_per_million)
    except ValueError:
        input_cost = output_cost = 0.0

    logger.info("%s — image generated in %.2fs", model_id, time_taken)

    return {
        "content": revised_prompt,
        "image_b64": b64,
        "prompt_tokens": prompt_tokens,
        "response_tokens": response_tokens,
        "input_cost": input_cost,
        "output_cost": output_cost,
        "time_taken": time_taken,
        "http_code": 200,
    }
