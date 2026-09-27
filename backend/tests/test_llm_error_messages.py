"""Gemini failures must not leak the raw provider error to the client (AI-07)."""

from app.services.llm_base import _gemini_client_message


def test_rate_limit_maps_to_friendly_message():
    msg = _gemini_client_message(
        RuntimeError("429 Resource has been exhausted (rate limit)")
    )
    assert "rate limit" in msg.lower()


def test_timeout_maps_to_friendly_message():
    msg = _gemini_client_message(RuntimeError("Deadline exceeded while calling model"))
    assert "timed out" in msg.lower()


def test_generic_error_does_not_leak_provider_text():
    secret = "503 backend error: prompt='SECRET PROMPT' key=abcd1234"
    msg = _gemini_client_message(RuntimeError(secret))
    assert msg == "AI analysis failed. Please try again later."
    assert "SECRET" not in msg
    assert "abcd1234" not in msg
