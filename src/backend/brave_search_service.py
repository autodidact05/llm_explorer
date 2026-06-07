from __future__ import annotations

import logging
import os
import re
from datetime import UTC, datetime
from typing import Any, TypedDict

import requests

import backend.config as _config
from backend.chat_timeouts import BRAVE_SEARCH_TIMEOUT_SEC

logger = logging.getLogger(__name__)


class BraveSource(TypedDict):
    title: str
    url: str


_WEB_SEARCH_INTENT_RE = re.compile(
    r"(?:"
    r"\b(?:latest|recent|current|today|tonight|yesterday|now|right\s+now)\b"
    r"|\b(?:news|headlines|breaking)\b"
    r"|\b(?:stock\s+price|share\s+price|market\s+cap)\b"
    r"|\b(?:weather|forecast)\b"
    r"|\b(?:who\s+won|who\s+is\s+winning|score\s+of)\b"
    r"|\b(?:this\s+week|this\s+month|this\s+year)\b"
    r"|\b(?:look\s+up|search\s+(?:the\s+)?(?:web|internet)|browse\s+the\s+web)\b"
    r"|\b(?:on\s+the\s+internet|from\s+the\s+web)\b"
    r"|\btell\s+me\s+about\b[^.!?\n]{0,60}\b(?:latest|news|update)\b"
    r")",
    re.IGNORECASE,
)

_NEWS_HINT_RE = re.compile(r"\b(?:news|headlines|latest|breaking|today|tonight)\b", re.IGNORECASE)

_WEB_SEARCH_NOTE = (
    "When the user message includes a [Brave Search results] block, those results are live "
    "data retrieved via Brave Search moments ago.\n"
    "Required for that reply:\n"
    "1. State clearly near the start that you performed a web search using Brave Search.\n"
    "2. Use the search results for current facts; do not claim you lack internet access.\n"
    "3. Summarize in English only; translate or romanize non-English titles when citing them.\n"
    "   Never reply using Hindi, Bengali, Arabic, or other non-Latin scripts.\n"
    "4. End with a **Sources** section listing each source URL from the search block as a "
    "markdown link (one per line)."
)

_FOOTER_MARKER = "<!-- brave-search-sources -->"


def get_brave_api_key() -> str:
    return os.environ.get("BRAVE_API_KEY", "").strip()


def is_brave_configured() -> bool:
    return bool(get_brave_api_key())


def should_web_search(user_text: str) -> bool:
    return bool(_WEB_SEARCH_INTENT_RE.search(user_text))


def append_web_search_note(message: str | None) -> str:
    """Append instructions so models use injected Brave results."""
    note = _WEB_SEARCH_NOTE
    if message and message.strip():
        return f"{message.strip()}\n\n{note}"
    return note


def _extract_query(user_text: str) -> str:
    return user_text.strip()[:400]


def brave_web_search(query: str, *, count: int = 8) -> dict[str, Any]:
    """Call Brave Web Search API. Raises requests.HTTPError on failure."""
    api_key = get_brave_api_key()
    if not api_key:
        raise RuntimeError("BRAVE_API_KEY is not configured")

    url = os.environ.get("BRAVE_SEARCH_URL", "").strip() or _config.BRAVE_SEARCH_URL
    if url.rstrip("/").endswith("/search") and "/res/v1/" not in url:
        url = _config.BRAVE_SEARCH_URL

    params: dict[str, str | int] = {"q": _extract_query(query), "count": count}
    if _NEWS_HINT_RE.search(query):
        params["freshness"] = "pw"

    response = requests.get(
        url,
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": api_key,
        },
        params=params,
        timeout=BRAVE_SEARCH_TIMEOUT_SEC,
    )
    response.raise_for_status()
    return response.json()


def collect_brave_sources(payload: dict[str, Any]) -> list[BraveSource]:
    """Deduplicated list of sources from Brave news + web results."""
    sources: list[BraveSource] = []
    seen: set[str] = set()

    def _add(item: dict[str, Any]) -> None:
        url = str(item.get("url") or "").strip()
        if not url or url in seen:
            return
        seen.add(url)
        title = str(item.get("title") or "").strip() or url
        sources.append({"title": title, "url": url})

    for item in (payload.get("news") or {}).get("results") or []:
        if isinstance(item, dict):
            _add(item)
    for item in (payload.get("web") or {}).get("results") or []:
        if isinstance(item, dict):
            _add(item)

    return sources


def format_brave_results(payload: dict[str, Any]) -> str:
    """Format Brave JSON into a compact context block for the LLM."""
    fetched = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    lines: list[str] = [
        f"[Brave Search results — live web search via Brave Search API, retrieved {fetched}]"
    ]

    news_items = (payload.get("news") or {}).get("results") or []
    if news_items:
        lines.append("\nNews:")
        for i, item in enumerate(news_items[:6], 1):
            title = str(item.get("title") or "Untitled")
            desc = str(item.get("description") or item.get("snippet") or "").strip()
            url = str(item.get("url") or "")
            age = str(item.get("age") or "")
            age_part = f" ({age})" if age else ""
            lines.append(f"{i}. {title}{age_part}\n   {desc}\n   URL: {url}")

    web_items = (payload.get("web") or {}).get("results") or []
    if web_items:
        lines.append("\nWeb:")
        for i, item in enumerate(web_items[:8], 1):
            title = str(item.get("title") or "Untitled")
            desc = str(item.get("description") or "").strip()
            url = str(item.get("url") or "")
            lines.append(f"{i}. {title}\n   {desc}\n   URL: {url}")

    if len(lines) == 1:
        lines.append("(No results returned.)")

    return "\n".join(lines)


def format_brave_sources_footer(sources: list[BraveSource]) -> str:
    """Markdown footer with Brave attribution and verifiable source URLs."""
    if not sources:
        return ""
    link_lines = "\n".join(f"- [{s['title']}]({s['url']})" for s in sources)
    return (
        f"\n\n---\n{_FOOTER_MARKER}\n\n"
        "**Web search:** This answer used live data from **[Brave Search](https://brave.com/search/)**.\n\n"
        "**Sources:**\n"
        f"{link_lines}"
    )


def append_brave_attribution(content: str, sources: list[BraveSource]) -> str:
    """Ensure Brave attribution and source URLs appear at the end of the reply."""
    footer = format_brave_sources_footer(sources)
    if not footer:
        return content
    if _FOOTER_MARKER in content:
        return content
    return content.rstrip() + footer


def _last_user_text(messages: list[dict[str, Any]]) -> str:
    for msg in reversed(messages):
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [
                p.get("text", "")
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ]
            return "\n".join(parts)
    return ""


def augment_messages_with_web_search(
    messages: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool, list[BraveSource]]:
    """Inject Brave search context into the last user turn when appropriate."""
    user_text = _last_user_text(messages)
    if not user_text or not is_brave_configured() or not should_web_search(user_text):
        return messages, False, []

    sources: list[BraveSource] = []
    try:
        payload = brave_web_search(user_text)
        context_block = format_brave_results(payload)
        sources = collect_brave_sources(payload)
    except Exception as exc:
        logger.warning("Brave web search failed: %s", exc)
        context_block = (
            "[Brave Search results — retrieval failed]\n"
            f"Search could not be completed ({exc}). Answer from general knowledge and note "
            "that live web data was unavailable."
        )

    augmented = [dict(m) for m in messages]
    for i in range(len(augmented) - 1, -1, -1):
        if augmented[i].get("role") != "user":
            continue
        content = augmented[i].get("content")
        if isinstance(content, str):
            augmented[i]["content"] = (
                f"{context_block}\n\n---\n\nUser question:\n{content}"
            )
        elif isinstance(content, list):
            new_content: list[dict[str, Any]] = [
                {"type": "text", "text": f"{context_block}\n\n---\n\nUser question:\n"}
            ]
            new_content.extend(content)
            augmented[i]["content"] = new_content
        break

    return augmented, True, sources
