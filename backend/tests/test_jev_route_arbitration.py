"""Jev route-pair arbitration of the review tier (Phase 3)."""

from __future__ import annotations

from types import SimpleNamespace

from app.integrations import jev_client
from app.integrations.jev_client import JevAnswer, JevResult
from app.services import route_service


def _route(name: str, km: float = 40.0) -> SimpleNamespace:
    return SimpleNamespace(name=name, distance_meters=km * 1000)


def _pair(tier: str = "review") -> dict:
    return {
        "route_a": _route("A"),
        "route_b": _route("B"),
        "score": 0.7,
        "tier": tier,
        "breakdown": {},
        "requires_confirmation": tier != "auto",
    }


def _res(choice: str, conf: float) -> JevResult:
    return JevResult(
        answers={"same": JevAnswer("choice", choice=choice, confidence=conf)},
        model="jev-test",
        computed_at="z",
    )


class TestRouteArbitration:
    async def test_different_high_confidence_dropped(self, monkeypatch):
        monkeypatch.setattr(jev_client, "is_configured", lambda: True)

        async def fake(a, b):
            return _res("different", 0.9)

        monkeypatch.setattr(route_service, "_arbitrate_route_pair", fake)
        assert await route_service._apply_route_arbitration([_pair()]) == []

    async def test_different_low_confidence_kept(self, monkeypatch):
        monkeypatch.setattr(jev_client, "is_configured", lambda: True)

        async def fake(a, b):
            return _res("different", 0.5)

        monkeypatch.setattr(route_service, "_arbitrate_route_pair", fake)
        out = await route_service._apply_route_arbitration([_pair()])
        assert len(out) == 1 and out[0]["jev_decision"] == "different"

    async def test_same_annotated_and_kept(self, monkeypatch):
        monkeypatch.setattr(jev_client, "is_configured", lambda: True)

        async def fake(a, b):
            return _res("same", 0.8)

        monkeypatch.setattr(route_service, "_arbitrate_route_pair", fake)
        out = await route_service._apply_route_arbitration([_pair()])
        assert len(out) == 1
        assert out[0]["jev_decision"] == "same"
        assert out[0]["jev_confidence"] == 0.8

    async def test_auto_tier_never_arbitrated(self, monkeypatch):
        monkeypatch.setattr(jev_client, "is_configured", lambda: True)
        calls = {"n": 0}

        async def fake(a, b):
            calls["n"] += 1
            return _res("different", 0.9)

        monkeypatch.setattr(route_service, "_arbitrate_route_pair", fake)
        out = await route_service._apply_route_arbitration([_pair("auto")])
        assert len(out) == 1 and calls["n"] == 0

    async def test_noop_when_unconfigured(self, monkeypatch):
        monkeypatch.setattr(jev_client, "is_configured", lambda: False)
        out = await route_service._apply_route_arbitration([_pair()])
        assert len(out) == 1 and "jev_decision" not in out[0]
