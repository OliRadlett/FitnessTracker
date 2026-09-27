"""Integration tests for the strength-video API (§1.1) ownership guards.

Covers the create-video safeguards: an uploaded R2 key must sit under the
caller's ``lift_videos/{user_id}/`` namespace, and linked lifting sessions /
personal records must belong to the caller.

Run with:  pytest tests/integration/test_videos_api.py -m integration
"""

from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.integration

BASE = "/api/v1/lifting/videos"


def _payload(user_id, **overrides) -> dict:
    payload = {
        "r2_key": f"lift_videos/{user_id}/deadbeef-clip.mp4",
        "file_name": "clip.mp4",
        "content_type": "video/mp4",
        "size_bytes": 1024,
    }
    payload.update(overrides)
    return payload


class TestCreateVideoOwnership:
    """POST /api/v1/lifting/videos/ — ownership guards run before R2 config."""

    async def test_foreign_r2_key_rejected(self, client, test_user):
        payload = _payload(uuid.uuid4())  # another user's namespace
        resp = await client.post(f"{BASE}/", json=payload)
        assert resp.status_code == 400
        assert "belong" in resp.json()["detail"].lower()

    async def test_unprefixed_r2_key_rejected(self, client, test_user):
        payload = _payload(test_user.id, r2_key="uploads/clip.mp4")
        resp = await client.post(f"{BASE}/", json=payload)
        assert resp.status_code == 400

    async def test_foreign_lifting_session_rejected(self, client, test_user):
        payload = _payload(test_user.id, lifting_session_id=str(uuid.uuid4()))
        resp = await client.post(f"{BASE}/", json=payload)
        assert resp.status_code == 404

    async def test_foreign_personal_record_rejected(self, client, test_user):
        payload = _payload(test_user.id, personal_record_id=str(uuid.uuid4()))
        resp = await client.post(f"{BASE}/", json=payload)
        assert resp.status_code == 404

    async def test_owned_links_pass_to_r2_guard(
        self, client, test_user, test_lifting_session, test_personal_record
    ):
        """Owned session + PR clear the ownership guards, then hit the 501
        (R2 unconfigured in tests) — proving ownership itself does not block."""
        payload = _payload(
            test_user.id,
            lifting_session_id=str(test_lifting_session.id),
            personal_record_id=str(test_personal_record.id),
        )
        resp = await client.post(f"{BASE}/", json=payload)
        assert resp.status_code == 501

    async def test_invalid_size_rejected_before_ownership(self, client, test_user):
        payload = _payload(test_user.id, size_bytes=0)
        resp = await client.post(f"{BASE}/", json=payload)
        assert resp.status_code == 400
