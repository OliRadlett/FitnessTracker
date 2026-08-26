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
STRAVA_API_BASE = "https://www.strava.com/api/v3"


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
        """Fetch time-series streams for a Strava activity."""
        if stream_types is None:
            stream_types = [
                "time",
                "heartrate",
                "watts",
                "cadence",
                "altitude",
                "velocity_smooth",
            ]

        keys = ",".join(stream_types)

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
