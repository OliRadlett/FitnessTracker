"""Disconnecting must revoke the grant, not just delete our row.

``DELETE /connections/{id}`` used to drop the ``OAuthConnection`` and say
"Disconnected from X". The provider kept listing FitTrack as an authorised app,
so the user had to remove it by hand elsewhere — after being told they were done.

Every revocable provider is covered, and two are deliberately not:
Komoot authenticates with Basic Auth rather than a revocable grant, and
Withings' revoke parameter shape could not be verified, so calling it would mean
a request that fails silently forever. Both are named in the module so the gap is
a statement rather than an omission.

The contract that matters most: a revoke failure must never block the
disconnect. Provider down → row still goes, ``grant_revoked`` reports False.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.integrations.strava_client import strava_client
from app.integrations.wahoo_client import wahoo_client
from app.integrations.whoop_client import whoop_client
from app.services.connection_revocation import revoke_grant, revoke_guidance


def _connection(provider: str, token: str = "token-123") -> SimpleNamespace:
    return SimpleNamespace(provider=provider, access_token=token)


@pytest.mark.parametrize(
    ("provider", "client", "method"),
    [
        ("strava", strava_client, "revoke_token"),
        ("whoop", whoop_client, "revoke_access"),
        ("wahoo", wahoo_client, "revoke_access"),
    ],
)
class TestRevocableProviders:
    async def test_revokes_with_the_connection_token(
        self, provider, client, method, monkeypatch
    ):
        seen: list[str] = []

        async def fake_revoke(token: str) -> None:
            seen.append(token)

        monkeypatch.setattr(client, method, fake_revoke)

        assert await revoke_grant(_connection(provider, "abc123")) is True
        assert seen == ["abc123"]

    async def test_provider_error_is_swallowed(self, provider, client, method, monkeypatch):
        """A provider outage must not strand the user mid-disconnect."""

        async def failing_revoke(token: str) -> None:
            raise RuntimeError("503 Service Unavailable")

        monkeypatch.setattr(client, method, failing_revoke)

        assert await revoke_grant(_connection(provider)) is False


class TestUnrevocableProviders:
    @pytest.mark.parametrize("provider", ["withings", "komoot"])
    async def test_reports_false_without_making_a_request(self, provider, monkeypatch):
        """No revoke call exists (or is safe) — must not raise, must not pretend."""

        def _explode(*args, **kwargs):  # pragma: no cover - must not be called
            raise AssertionError("no request should be attempted")

        monkeypatch.setattr(strava_client, "revoke_token", _explode)

        assert await revoke_grant(_connection(provider)) is False

    async def test_unknown_provider_is_not_an_error(self):
        """A future provider lands here rather than raising AttributeError."""
        assert await revoke_grant(_connection("garmin")) is False


class TestRevokeGuidance:
    """What the user is told when we cannot revoke for them."""

    @pytest.mark.parametrize("provider", ["withings", "komoot"])
    def test_unrevocable_providers_name_the_manual_step(self, provider):
        note = revoke_guidance(provider)

        assert note is not None
        assert len(note) > 20

    def test_a_failed_revocable_provider_gets_no_special_guidance(self):
        """`grant_revoked: false` already says it; there is no manual path worth
        printing for a provider we *can* revoke — the user should retry."""
        assert revoke_guidance("strava") is None

    def test_unknown_provider_says_nothing(self):
        """Inventing instructions is worse than silence."""
        assert revoke_guidance("garmin") is None
