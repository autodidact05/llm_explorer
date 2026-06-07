from backend.response_quality import append_response_quality


def test_append_response_quality_english_only() -> None:
    out = append_response_quality("You are helpful.")
    assert "English only" in out
    assert "consecutive numbering" in out.lower() or "1, 2, 3" in out
