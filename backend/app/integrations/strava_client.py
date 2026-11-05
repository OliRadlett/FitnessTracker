"""Strava integration client — OAuth, activity fetch, stream fetch."""

import logging
from datetime import datetime

import httpx

from app.config import get_settings
from app.integrations.retry import retry_request

logger = logging.getLogger(__name__)

settings = get_settings()

STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize"
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_REVOKE_URL = "https://www.strava.com/oauth/revoke"
STRAVA_API_BASE = "https://www.strava.com/api/v3"

# Streams requested by default. ``keys`` is comma-separated, so adding a type
# costs **no extra API call** — only payload bytes. That changes the usual
# trade-off: the question is not "is this worth a request?" but "is this worth
# storing?".
#
# ``latlng`` earns its place because ``services/replay.py`` reads it. Without it
# every Strava ride falls back to interpolating the route polyline, which
# resamples a *shape* — losing switchbacks, and any part of the ride that left
# the matched route — instead of using the recorded GPS.
#
# Deliberately absent: ``temp`` and ``grade_smooth``. Neither has a consumer in
# this codebase (FIT imports store a ``temperature`` stream and nothing reads
# it), so asking for them would add two more stored-but-never-read streams. The
# order to do those in is: write the reader, then add the key.
DEFAULT_STREAM_TYPES = (
    "time",
    "heartrate",
    "watts",
    "cadence",
    "altitude",
    "velocity_smooth",
    "distance",
    "latlng",
)


def stream_keys(stream_types: list[str] | None = None) -> str:
    """Comma-separated ``keys`` for a streams request.

    Falls back to :data:`DEFAULT_STREAM_TYPES`; an explicit list replaces it
    entirely (the endpoint has no additive mode).
    """
    return ",".join(stream_types or DEFAULT_STREAM_TYPES)



class StravaClient:
    """HTTP client for the Strava API."""

    def __init__(self):
        self.client_id = settings.strava_client_id
        self.client_secret = settings.strava_client_secret

    def get_authorize_url(self, redirect_uri: str) -> str:
        """Build Strava OAuth authorize URL."""
        return (
            f"{STRAVA_AUTH_URL}?"
            f"client_id={self.client_id}&redirect_uri={redirect_uri}"
            f"&response_type=code&scope=read,activity:read_all,profile:read_all"
        )

    async def exchange_code(self, code: str) -> dict:
        """Exchange authorization code for tokens."""

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    STRAVA_TOKEN_URL,
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "code": code,
                        "grant_type": "authorization_code",
                    },
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def refresh_access_token(self, refresh_token: str) -> dict:
        """Refresh an expired Strava access token."""

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    STRAVA_TOKEN_URL,
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "refresh_token": refresh_token,
                        "grant_type": "refresh_token",
                    },
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def revoke_token(self, access_token: str) -> None:
        """Revoke this app's grant for the athlete.

        Called when a user disconnects, so FitTrack disappears from their Strava
        settings instead of lingering as an authorised app. The endpoint takes
        the access token in the form body; no client secret is required.
        """

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    STRAVA_REVOKE_URL,
                    data={"access_token": access_token},
                )
                resp.raise_for_status()

        await retry_request(_fetch)

    async def get_activities(
        self,
        access_token: str,
        after: datetime | None = None,
        before: datetime | None = None,
        page: int = 1,
        per_page: int = 100,
    ) -> list[dict]:
        """Fetch athlete activities from Strava."""
        params: dict = {"page": page, "per_page": per_page}
        if after:
            params["after"] = int(after.timestamp())
        if before:
            params["before"] = int(before.timestamp())

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{STRAVA_API_BASE}/athlete/activities",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params=params,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def get_activity_detail(self, access_token: str, activity_id: int) -> dict:
        """Fetch detailed info for a single Strava activity."""

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{STRAVA_API_BASE}/activities/{activity_id}",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"include_all_efforts": True},
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def get_activity_streams(
        self,
        access_token: str,
        activity_id: int,
        stream_types: list[str] | None = None,
    ) -> dict:
        """Fetch time-series streams for a Strava activity.

        ``distance`` is the cumulative-metres stream. It is what makes §3.13
        segment alignment exact: integrating ``velocity_smooth`` accumulates
        error over a long ride and drifts relative to the route polyline, so
        the window can miss the alignment tolerance entirely. Older activities
        already synced don't have it — every consumer falls back to
        integrating velocity.

        ``latlng`` is included by default (see ``DEFAULT_STREAM_TYPES``) so
        replay can use the recorded GPS instead of resampling the route shape.
        """
        keys = stream_keys(stream_types)

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{STRAVA_API_BASE}/activities/{activity_id}/streams",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"keys": keys, "key_type": "time", "resolution": "high"},
                )
                resp.raise_for_status()
                streams = resp.json()
                return {s["type"]: s for s in streams}

        return await retry_request(_fetch)

    async def get_gear(self, access_token: str, gear_id: str) -> dict:
        """Fetch one gear item.

        Returns ``id``, ``name`` (brand + model + nickname), ``brand_name``,
        ``model_name``, ``frame_type`` (1 MTB, 2 CX, 3 road, 4 TT — bikes only),
        ``primary`` and ``distance`` in **metres**, which is the provider's
        lifetime total for that item and therefore the only wear signal Strava
        exposes. There is no create/update/retire endpoint; gear is managed in the
        Strava UI.
        """

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{STRAVA_API_BASE}/gear/{gear_id}",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def get_athlete(self, access_token: str) -> dict:
        """Fetch the authenticated athlete profile."""

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{STRAVA_API_BASE}/athlete",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def get_athlete_routes(
        self,
        access_token: str,
        athlete_id: int | None = None,
        page: int = 1,
        per_page: int = 30,
    ) -> list[dict]:
        """Fetch athlete's saved routes from Strava Routes API.

        If athlete_id is not provided, fetches /athlete to get the ID first.
        """
        if athlete_id is None:
            athlete = await self.get_athlete(access_token)
            athlete_id = athlete["id"]

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{STRAVA_API_BASE}/athletes/{athlete_id}/routes",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"page": page, "per_page": per_page},
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def get_route_detail(self, access_token: str, route_id: int) -> dict:
        """Fetch detailed info for a single Strava route."""

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{STRAVA_API_BASE}/routes/{route_id}",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)


# Singleton
strava_client = StravaClient()
