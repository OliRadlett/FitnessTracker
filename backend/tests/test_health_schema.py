"""The health check must fail when the database schema is not at head.

Before 2026-11-04 ``/health`` only ran ``SELECT 1``; a half-applied release
could serve 200 against the old schema. These tests stub the DB/Redis boundary
and assert the revision comparison, including the 503 response.
"""

from __future__ import annotations

import json

from app import main


class _Result:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _Session:
    def __init__(self, revision: str):
        self.revision = revision

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None

    async def execute(self, statement):
        if "version_num" in str(statement):
            return _Result(self.revision)
        return _Result(None)


class _Factory:
    def __init__(self, revision: str):
        self.revision = revision

    def __call__(self):
        return _Session(self.revision)


class _Redis:
    async def ping(self):
        return True


async def _health(monkeypatch, *, revision: str, head: str):
    monkeypatch.setattr(main, "async_session_factory", _Factory(revision))
    monkeypatch.setattr(main, "_get_redis_client", lambda: _Redis())
    monkeypatch.setattr(main, "_migration_head", lambda: head)
    return await main.health_check()


async def test_health_accepts_matching_revision(monkeypatch):
    response = await _health(monkeypatch, revision="103", head="103")
    assert response["status"] == "ok"
    assert response["schema"] == "ok"
    assert response["db_revision"] == "103"


async def test_health_rejects_schema_mismatch(monkeypatch):
    response = await _health(monkeypatch, revision="102", head="103")
    assert response.status_code == 503
    payload = json.loads(response.body)
    assert payload["status"] == "degraded"
    assert payload["schema"] == "error"
    assert payload["db_revision"] == "102"
    assert payload["db_head"] == "103"
