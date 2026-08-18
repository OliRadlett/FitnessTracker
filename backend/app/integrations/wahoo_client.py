"""Wahoo integration client — OAuth, routes/workouts fetch."""

import logging

import httpx

from app.config import get_settings
from app.integrations.retry import retry_request

logger = logging.getLogger(__name__)

settings = get_settings()

WAHOO_API_BASE = "https://api.wahooligan.com"
WAHOO_AUTH_URL = f"{WAHOO_API_BASE}/oauth/authorize"
WAHOO_TOKEN_URL = f"{WAHOO_API_BASE}/oauth/token"


class WahooClient:
    """HTTP client for the Wahoo Cloud API."""

    def __init__(self):
        self.client_id = settings.wahoo_client_id
        self.client_secret = settings.wahoo_client_secret

    def get_authorize_url(self, redirect_uri: str) -> str:
        """Build Wahoo OAuth authorize URL."""
        return (
            f"{WAHOO_AUTH_URL}?"
            f"client_id={self.client_id}&redirect_uri={redirect_uri}"
            f"&response_type=code&scope=user_read+workouts_read+routes_read"
        )

    async def exchange_code(self, code: str, redirect_uri: str) -> dict:
        """Exchange authorization code for tokens."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                WAHOO_TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
            return resp.json()

    async def refresh_access_token(self, refresh_token: str) -> dict:
        """Refresh an expired Wahoo access token."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                WAHOO_TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_user(self, access_token: str) -> dict:
        """Fetch the authenticated user profile."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{WAHOO_API_BASE}/v1/user",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_routes(
        self,
        access_token: str,
        page: int = 1,
        per_page: int = 50,
    ) -> list[dict]:
        """Fetch user's saved routes."""

        async def _fetch():
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{WAHOO_API_BASE}/v1/routes",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"page": page, "per_page": per_page},
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def get_route_detail(self, access_token: str, route_id: int) -> dict:
        """Fetch detailed info for a single route."""

        async def _fetch():
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{WAHOO_API_BASE}/v1/routes/{route_id}",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def get_workouts(
        self,
        access_token: str,
        page: int = 1,
        per_page: int = 50,
    ) -> list[dict]:
        """Fetch user's completed workouts."""

        async def _fetch():
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{WAHOO_API_BASE}/v1/workouts",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"page": page, "per_page": per_page},
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)


# Singleton
wahoo_client = WahooClient()
