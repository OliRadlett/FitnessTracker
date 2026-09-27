"""Presigned-PUT signature guards (regression #104).

#104 bound ``ContentLength`` into the presigned PUT so a client can't presign
for a small file then upload a larger body. But the derived artifacts
(trimmed video / overlay / rep sprites / pose track) are produced inside the
Modal container, and the scheduler passed the *source video's* size (or a
guessed constant) as that declared length. R2 then rejected every derived
upload with **403** — no overlay, no pose track, no sprites.

The declared size must only be bound when it is actually known (the user's own
upload); derived artifacts must leave it unbound.
"""

import asyncio
import uuid

import pytest

from app.integrations import r2


class _FakeSettings:
    r2_bucket = "test-bucket"


class _FakeClient:
    def __init__(self) -> None:
        self.params: dict | None = None

    def generate_presigned_url(self, ClientMethod, Params=None, ExpiresIn=None):
        self.params = Params
        return "https://example.invalid/put"


@pytest.fixture
def fake_client(monkeypatch):
    client = _FakeClient()
    monkeypatch.setattr(r2, "_s3_client", lambda: client)
    monkeypatch.setattr(r2, "get_settings", lambda: _FakeSettings())
    return client


def test_declared_size_is_bound_when_known(fake_client):
    asyncio.run(
        r2.create_presigned_put(uuid.uuid4(), "clip.mp4", "video/mp4", 1234)
    )
    assert fake_client.params["ContentLength"] == 1234


def test_derived_artifact_does_not_bind_content_length(fake_client):
    asyncio.run(
        r2.create_presigned_put(uuid.uuid4(), "trimmed-clip.mp4", "video/mp4")
    )
    assert "ContentLength" not in fake_client.params
