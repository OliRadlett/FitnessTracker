"""Integration tests for user UI preferences (unit system, locale, time format).

Run with:  pytest tests/integration/test_preferences.py -m integration
"""

from __future__ import annotations

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


class TestPreferencesService:
    async def test_defaults_when_null(self, test_user):
        from app.services.preferences import get_preferences

        assert test_user.preferences is None
        prefs = get_preferences(test_user)
        assert prefs.unit_system == "metric"
        assert prefs.locale == "en-GB"
        assert prefs.time_format == "24h"

    async def test_partial_update_merges(self, db_session, test_user):
        from app.services.preferences import get_preferences, set_preferences

        updated = await set_preferences(
            db_session, test_user, {"unit_system": "imperial"}
        )
        assert updated.unit_system == "imperial"
        assert updated.locale == "en-GB"  # untouched default preserved

        db_session.expire_all()
        prefs = get_preferences(test_user)
        assert prefs.unit_system == "imperial"
        assert prefs.time_format == "24h"

    async def test_invalid_value_rejected(self, db_session, test_user):
        from app.services.preferences import set_preferences

        with pytest.raises(ValueError):
            await set_preferences(db_session, test_user, {"time_format": "25h"})


class TestPreferencesApi:
    """GET/PATCH /api/v1/user/preferences."""

    async def test_get_returns_defaults(self, client):
        resp = await client.get("/api/v1/user/preferences")
        assert resp.status_code == 200
        body = resp.json()
        assert body == {
            "unit_system": "metric",
            "locale": "en-GB",
            "time_format": "24h",
        }

    async def test_patch_updates_and_round_trips(self, client):
        resp = await client.patch(
            "/api/v1/user/preferences",
            json={"unit_system": "imperial", "time_format": "12h"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["unit_system"] == "imperial"
        assert body["time_format"] == "12h"
        assert body["locale"] == "en-GB"

        again = await client.get("/api/v1/user/preferences")
        assert again.json()["unit_system"] == "imperial"
        assert again.json()["time_format"] == "12h"

    async def test_invalid_value_returns_422(self, client):
        resp = await client.patch(
            "/api/v1/user/preferences",
            json={"locale": "fr-FR"},
        )
        assert resp.status_code == 422
