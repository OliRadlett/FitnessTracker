"""Recognising Strava's "the athlete revoked your access" event.

Strava's deauthorisation arrives as ``object_type=athlete`` with
``updates={"authorized": "false"}`` — a **string**, not a boolean. The handler used
to return early on anything that was not an activity, so a revocation was only
discovered by the next sync's 401: up to half an hour later, as a failed sync in
the logs, while the UI still showed the connection as healthy.

The predicate is separated out because getting it wrong is quiet in both
directions: too narrow and revocations are missed (the old bug), too wide and
every athlete profile update marks a healthy connection as broken.
"""

from __future__ import annotations

import pytest

from app.services.strava.webhooks import is_athlete_deauthorization


class TestRecognised:
    @pytest.mark.parametrize(
        "updates",
        [
            {"authorized": "false"},  # what Strava sends
            {"authorized": False},  # defensive: documented as a string
            {"authorized": "FALSE"},
            {"authorized": " false "},
        ],
    )
    def test_authorized_false_in_any_spelling(self, updates):
        assert is_athlete_deauthorization("athlete", "update", updates) is True

    def test_a_delete_of_the_athlete_object_is_a_revocation(self):
        """The reference allows `delete` for the same event, with no updates."""
        assert is_athlete_deauthorization("athlete", "delete", {}) is True
        assert is_athlete_deauthorization("athlete", "delete", None) is True


class TestNotRecognised:
    def test_activity_events_are_not_deauthorisations(self):
        assert is_athlete_deauthorization("activity", "update", {"authorized": "false"}) is False

    @pytest.mark.parametrize("updates", [{"authorized": "true"}, {}, None])
    def test_a_plain_athlete_update_is_not_a_revocation(self, updates):
        """Profile changes arrive on the same object type and must be ignored."""
        assert is_athlete_deauthorization("athlete", "update", updates) is False

    def test_create_is_not_a_revocation(self):
        assert is_athlete_deauthorization("athlete", "create", {}) is False

    def test_unknown_object_types_are_ignored(self):
        assert is_athlete_deauthorization("club", "update", {"authorized": "false"}) is False
