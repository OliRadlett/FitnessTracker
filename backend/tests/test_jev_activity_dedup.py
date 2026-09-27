"""Jev arbitration of the ambiguous activity-dedup band (Phase 4 part 2)."""

from __future__ import annotations

from types import SimpleNamespace

from app.integrations import jev_client
from app.integrations.jev_client import JevAnswer, JevResult
from app.services import merge_service


def _candidate(name: str = "Ride") -> SimpleNamespace:
    return SimpleNamespace(name=name)


async def test_arbitrate_duplicate_none_without_name(monkeypatch):
    monkeypatch.setattr(jev_client, "is_configured", lambda: True)
    assert (
        await merge_service._arbitrate_duplicate(None, _candidate(), "cycling", 3600)
        is None
    )


async def test_arbitrate_duplicate_none_when_unconfigured(monkeypatch):
    monkeypatch.setattr(jev_client, "is_configured", lambda: False)
    assert (
        await merge_service._arbitrate_duplicate("A", _candidate("B"), "cycling", 3600)
        is None
    )


async def test_arbitrate_duplicate_returns_probability(monkeypatch):
    monkeypatch.setattr(jev_client, "is_configured", lambda: True)

    async def fake_decide(state, questions, **kwargs):
        return JevResult(
            answers={"same": JevAnswer("noul", noul=0.85, confidence=0.9)},
            model="jev-test",
            computed_at="z",
        )

    monkeypatch.setattr(jev_client, "decide", fake_decide)
    prob = await merge_service._arbitrate_duplicate(
        "A", _candidate("B"), "cycling", 3600
    )
    assert prob == 0.85


async def test_arbitrate_duplicate_none_on_decide_none(monkeypatch):
    monkeypatch.setattr(jev_client, "is_configured", lambda: True)

    async def fake_decide(state, questions, **kwargs):
        return None

    monkeypatch.setattr(jev_client, "decide", fake_decide)
    assert (
        await merge_service._arbitrate_duplicate("A", _candidate("B"), "cycling", 3600)
        is None
    )


def test_band_constants_sane():
    assert 0 < merge_service.MERGE_BAND_DELTA < 1
    assert merge_service.MERGE_DUPLICATE_THRESHOLD > 0.5
