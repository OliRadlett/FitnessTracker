"""Unit tests for the duplicate-scan state reader.

Redis hashes come back as bytes with ``redis.asyncio``'s default decoder. The
first cut indexed them with ``str`` keys, so the API reported ``never`` while
Redis held ``running`` — the scan looked like it had never been queued.
"""

from app.services.route_similarity import decode_hash


def test_decodes_a_bytes_hash():
    raw = {
        b"state": b"running",
        b"started_at": b"2026-11-05T12:11:30+00:00",
        b"pairs": b"",
        b"error": b"",
    }
    assert decode_hash(raw) == {
        "state": "running",
        "started_at": "2026-11-05T12:11:30+00:00",
        "pairs": "",
        "error": "",
    }


def test_leaves_a_str_hash_alone():
    raw = {"state": "ready", "pairs": "8"}
    assert decode_hash(raw) == raw


def test_mixed_hash():
    assert decode_hash({b"state": b"queued", "pairs": "0"}) == {
        "state": "queued",
        "pairs": "0",
    }
