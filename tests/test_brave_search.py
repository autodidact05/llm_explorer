from backend.brave_search_service import (
    append_brave_attribution,
    collect_brave_sources,
    format_brave_results,
    should_web_search,
)


def test_should_web_search_latest_news() -> None:
    assert should_web_search("Tell me about the latest news about Hindustan Lever")


def test_should_web_search_negative() -> None:
    assert not should_web_search("Explain recursion in Python")


def test_format_brave_results_includes_titles() -> None:
    payload = {
        "web": {
            "results": [
                {
                    "title": "Example Corp",
                    "description": "Company overview",
                    "url": "https://example.com",
                }
            ]
        }
    }
    text = format_brave_results(payload)
    assert "Brave Search" in text
    assert "Example Corp" in text
    assert "https://example.com" in text


def test_collect_brave_sources_dedupes() -> None:
    payload = {
        "news": {"results": [{"title": "A", "url": "https://a.com"}]},
        "web": {"results": [{"title": "A again", "url": "https://a.com"}, {"title": "B", "url": "https://b.com"}]},
    }
    sources = collect_brave_sources(payload)
    assert len(sources) == 2
    assert sources[0]["url"] == "https://a.com"
    assert sources[1]["url"] == "https://b.com"


def test_append_brave_attribution_adds_footer() -> None:
    sources = [{"title": "Example", "url": "https://example.com"}]
    out = append_brave_attribution("Answer text.", sources)
    assert "Brave Search" in out
    assert "**Sources:**" in out
    assert "https://example.com" in out
    assert append_brave_attribution(out, sources) == out
