"""Revoke the provider-side grant when a connection is disconnected.

Deleting an ``OAuthConnection`` row stops *us* using the tokens. It does not stop
the provider from still listing FitTrack as an authorised app, so until now
"Disconnected from Strava" was true only of our own database — the user had to
find the app in Strava's settings and remove it by hand, and would reasonably
assume they already had.

Every provider this app connects to exposes a revoke endpoint, so there is no
reason for that gap:

* Strava — ``POST /oauth/revoke`` with the access token.
* Whoop — ``DELETE /developer/v2/user/access``.
* Wahoo — ``DELETE /v1/permissions``.

Two are deliberately absent:

* **Komoot** is authenticated with Basic Auth (email + password), not a revocable
  OAuth grant. There is nothing to revoke; the credentials are the user's own.
* **Withings** documents an ``oauth2`` revoke action, but the exact parameter
  shape could not be verified here, and a request we cannot test is worse than a
  documented gap — it would fail silently forever. Its grant must be removed in
  Withings' own account settings. Worth revisiting with their OpenAPI spec.

Failures are logged, never raised. A user asking to disconnect must be
disconnected from us even when the provider is unreachable: the row is deleted
regardless, and the warning records that a grant may still be live.
"""

from __future__ import annotations

import logging

from app.integrations.strava_client import strava_client
from app.integrations.wahoo_client import wahoo_client
from app.integrations.whoop_client import whoop_client
from app.models.user import OAuthConnection

logger = logging.getLogger(__name__)


async def _revoke_strava(access_token: str) -> None:
    await strava_client.revoke_token(access_token)


async def _revoke_whoop(access_token: str) -> None:
    await whoop_client.revoke_access(access_token)


async def _revoke_wahoo(access_token: str) -> None:
    await wahoo_client.revoke_access(access_token)


_REVOKERS = {
    "strava": _revoke_strava,
    "whoop": _revoke_whoop,
    "wahoo": _revoke_wahoo,
}

# Providers with no revocable grant (or none we can call safely). Named so the
# absence is a statement rather than an oversight.
_UNREVOCABLE = {
    "komoot": "Basic Auth (email/password), not an OAuth grant",
    "withings": "revoke action unverified; remove the app in Withings' settings",
}


async def revoke_grant(connection: OAuthConnection) -> bool:
    """Best-effort revoke of the provider-side grant. Never raises.

    Returns ``True`` only when the provider accepted the revoke. ``False`` means
    "assume the grant is still live" — the caller should still delete the row,
    which is why this never raises.
    """
    provider = connection.provider
    revoke = _REVOKERS.get(provider)
    if revoke is None:
        logger.info(
            "No revoke call for provider %r (%s); deleting the local connection "
            "only",
            provider,
            _UNREVOCABLE.get(provider, "no revoke endpoint known"),
        )
        return False

    try:
        await revoke(connection.access_token)
    except Exception as exc:  # best effort by contract — see docstring
        logger.warning(
            "Could not revoke the %s grant: %s. The local connection is still "
            "being removed, but %s may still list FitTrack as authorised.",
            provider,
            exc,
            provider,
        )
        return False

    logger.info("Revoked the %s grant on disconnect", provider)
    return True


# What the user has to do by hand when we cannot revoke for them. A disconnect
# that cannot finish the job should say so and name the path, rather than leaving
# the app listed at the provider with no explanation.
_REVOKE_GUIDANCE = {
    "withings": (
        "FitTrack could not revoke its Withings access. Remove it in the "
        "Withings app under Settings → Partner apps → FitTrack."
    ),
    "komoot": (
        "Komoot uses your email and password rather than a revocable grant, so "
        "there is nothing to revoke — change the password there if you want to "
        "invalidate the stored credentials."
    ),
}


def revoke_guidance(provider: str) -> str | None:
    """Manual instructions when `revoke_grant` returns False, else None.

    Three cases, and only one of them needs saying:
    * revocable provider that failed → the caller reports ``grant_revoked:
      false``; the generic message is enough, no guidance.
    * no revocable grant at all (Withings unverified, Komoot Basic Auth) → say
      what to do by hand.
    * a provider we do not know → say nothing; inventing instructions is worse
      than silence.
    """
    return _REVOKE_GUIDANCE.get(provider)
