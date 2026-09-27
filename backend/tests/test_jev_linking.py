"""Jev arbitration of the ambiguous activity↔lifting-session band (Phase 4)."""

from __future__ import annotations

from types import SimpleNamespace

from app.integrations import jev_client
from app.integrations.jev_client import JevAnswer, JevResult
from app.services.strava import linking


def _activity() -> SimpleNamespace:
    return SimpleNamespace(name="Squat Session", sport_type="weightlifting")


def _session() -> SimpleNamespace:
    return SimpleNamespace(
        focus="squat", program_name=None, notes="felt heavy", session_date=None
    )


async def test_arbitrate_link_returns_none_when_unconfigured(monkeypatch):
    monkeypatch.setattr(jev_client, "is_configured", lambda: False)
    assert await linking._arbitrate_link(_activity(), _session()) is None


async def test_arbitrate_link_returns_probability(monkeypatch):
    monkeypatch.setattr(jev_client, "is_configured", lambda: True)

    async def fake_decide(state, questions, **kwargs):
        return JevResult(
            answers={"same": JevAnswer("noul", noul=0.9, confidence=0.8)},
            model="jev-test",
            computed_at="z",
        )

    monkeypatch.setattr(jev_client, "decide", fake_decide)
    assert await linking._arbitrate_link(_activity(), _session()) == 0.9


async def test_arbitrate_link_none_on_decide_none(monkeypatch):
    monkeypatch.setattr(jev_client, "is_configured", lambda: True)

    async def fake_decide(state, questions, **kwargs):
        return None

    monkeypatch.setattr(jev_client, "decide", fake_decide)
    assert await linking._arbitrate_link(_activity(), _session()) is None


def test_band_constants_sane():
    assert 0 < linking.LINK_BAND_DELTA < linking.MATCH_THRESHOLD
    assert linking.LINK_SAME_THRESHOLD > linking.MATCH_THRESHOLD
