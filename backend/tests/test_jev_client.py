"""Jev client contract (Phase 0).

Jev must be best-effort: never raise to the caller, no-op when unconfigured, and
run offline in tests. The SDK is never imported here (fake mode / monkeypatch).
"""

from __future__ import annotations

import pytest

from app.integrations import jev_client


def test_question_builder_shapes():
    assert jev_client.noul("Is it?") == {"type": "noul", "instructions": "Is it?"}
    assert jev_client.noul("Is it?", {"true": "yes", "false": "no"})["criteria"] == {
        "true": "yes",
        "false": "no",
    }
    ch = jev_client.choice("Pick", {"a": None, "b": "B"})
    assert ch["type"] == "choice" and ch["criteria"] == {"a": None, "b": "B"}
    sc = jev_client.score("Rate", ["low", "high"])
    assert sc["type"] == "score" and sc["criteria"] == ["low", "high"]


async def test_decide_empty_questions_returns_none():
    assert await jev_client.decide("state", {}) is None


async def test_decide_none_when_unconfigured(monkeypatch):
    monkeypatch.delenv("JEV_FAKE", raising=False)
    monkeypatch.setattr(jev_client, "is_configured", lambda: False)
    res = await jev_client.decide("state", {"x": jev_client.noul("?")})
    assert res is None


async def test_decide_fake_mode(monkeypatch):
    monkeypatch.setenv("JEV_FAKE", "1")
    res = await jev_client.decide(
        "state",
        {
            "pain": jev_client.noul("pain?"),
            "outcome": jev_client.choice("outcome?", {"grind": None, "pr": None}),
            "energy": jev_client.score("energy?", ["low", "ok", "high"]),
        },
    )
    assert res is not None
    assert res.noul("pain") == 0.5
    assert res.choice("outcome") == "grind"
    assert res.score("energy") == 0.0
    assert res.model  # populated from settings
    assert res.computed_at


async def test_decide_never_raises_on_call_error(monkeypatch):
    monkeypatch.delenv("JEV_FAKE", raising=False)
    monkeypatch.setattr(jev_client, "is_configured", lambda: True)

    async def boom(*args, **kwargs):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(jev_client, "_call", boom)
    res = await jev_client.decide("state", {"x": jev_client.noul("?")})
    assert res is None


async def test_decide_swallows_guard_http_exception(monkeypatch):
    """A 429 from the shared AI budget guard must not propagate."""
    from contextlib import asynccontextmanager

    from fastapi import HTTPException

    monkeypatch.delenv("JEV_FAKE", raising=False)
    monkeypatch.setattr(jev_client, "is_configured", lambda: True)

    @asynccontextmanager
    async def raising_guard(user_id, kind, target=""):
        raise HTTPException(status_code=429, detail="budget exceeded")
        yield  # pragma: no cover

    monkeypatch.setattr("app.services.llm_base.ai_generation_guard", raising_guard)

    res = await jev_client.decide(
        "state", {"x": jev_client.noul("?")}, user_id=__import__("uuid").uuid4()
    )
    assert res is None


def test_is_configured_false_without_key(monkeypatch):
    from app import config

    fake = type("S", (), {"typesafe_api_key": "", "jev_enabled": True})()
    monkeypatch.setattr(config, "get_settings", lambda: fake)
    assert jev_client.is_configured() is False

    fake2 = type("S", (), {"typesafe_api_key": "k", "jev_enabled": False})()
    monkeypatch.setattr(config, "get_settings", lambda: fake2)
    assert jev_client.is_configured() is False

    fake3 = type("S", (), {"typesafe_api_key": "k", "jev_enabled": True})()
    monkeypatch.setattr(config, "get_settings", lambda: fake3)
    assert jev_client.is_configured() is True
