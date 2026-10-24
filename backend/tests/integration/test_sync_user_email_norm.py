"""§2 Auth /sync-user email normalization (delivery-order finding #2).

The allowlist in ``is_email_allowed`` lowercases before matching, but the user
lookup was case-sensitive against a case-sensitive ``UNIQUE`` constraint. A
mixed-case email on first login therefore created a *second* user row instead of
reusing the existing one, splitting that person's fitness data across accounts.

Run with:  pytest tests/integration/test_sync_user_email_norm.py -m integration
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models.user import User

pytestmark = [pytest.mark.integration]


async def test_sync_user_reuses_existing_user_regardless_of_case(
    client, db_session, test_user
):
    """A mixed-case email must resolve to the existing lowercase user.

    Regression: without normalization the case-sensitive ``User.email == ...``
    lookup missed the row and a duplicate was created, then returned as a new
    user with a different ``id``.
    """
    settings = get_settings()
    with patch.object(settings, "internal_api_secret", "test-secret"):
        resp = await client.post(
            "/api/v1/auth/sync-user",
            headers={"x-internal-secret": "test-secret"},
            json={
                "email": "Test@Example.com",
                "name": test_user.name,
                "provider": "google",
                "provider_user_id": "google_12345",
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    # Same user — no duplicate created.
    assert body["user"]["id"] == str(test_user.id)
    # Email stored normalized to lowercase.
    assert body["user"]["email"] == "test@example.com"

    # No second row exists for the mixed-case spelling.
    dup = (
        await db_session.execute(
            select(User).where(User.email == "Test@Example.com")
        )
    ).scalar_one_or_none()
    assert dup is None


async def test_sync_user_normalizes_new_user_email(
    client, db_session
):
    """A brand-new user with a mixed-case email is stored in lowercase."""
    settings = get_settings()
    with patch.object(settings, "internal_api_secret", "test-secret"):
        resp = await client.post(
            "/api/v1/auth/sync-user",
            headers={"x-internal-secret": "test-secret"},
            json={
                "email": "New@Example.com",
                "name": "New User",
                "provider": "google",
                "provider_user_id": "google_99999",
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["email"] == "new@example.com"

    (row,) = await db_session.execute(
        select(User).where(User.email == "new@example.com")
    )
    assert row[0] is not None
