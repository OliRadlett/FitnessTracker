"""Komoot integration client — OAuth, tours/routes fetch."""

import httpx
import logging

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

KOMOOT_API_BASE = "https://api.komoot.de/v0.07"
KOMOOT_AUTH_URL = f"{KOMOOT_API_BASE}/oauth2/authorize"
KOMOOT_TOKEN_URL = f"{KOMOOT_API_BASE}/oauth2/token"


class KomootClient:
    """HTTP client for the Komoot API."""

    def __init__(self):
        self.client_id = settings.komoot_client_id
        self.client_secret = settings.komoot_client_secret

    def get_authorize_url(self, redirect_uri: str) -> str:
        """Build Komoot OAuth authorize URL."""
        return (
            f"{KOMOOT_AUTH_URL}?"
            f"client_id={self.client_id}&redirect_uri={redirect_uri}"
            f"&response_type=code&scope=read"
        )

    async def exchange_code(self, code: str, redirect_uri: str) -> dict:
        """Exchange authorization code for tokens."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                KOMOOT_TOKEN_URL,
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
        """Refresh an expired Komoot access token."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                KOMOOT_TOKEN_URL,
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

    async def get_account(self, access_token: str) -> dict:
        """Fetch the authenticated user's account info (contains user_id)."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{KOMOOT_API_BASE}/account",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_tours(
        self,
        access_token: str,
        user_id: str,
        page: int = 0,
        limit: int = 50,
    ) -> list[dict]:
        """Fetch user's completed tours (rides, hikes, etc.)."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{KOMOOT_API_BASE}/users/{user_id}/tours",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"page": page, "limit": limit, "sport_types": "mtb_race,mtb,road_race,touringbicycle,touringroadbicycle"},
            )
            resp.raise_for_status()
            data = resp.json()
            # Komoot returns tours under _embedded.items
            embedded = data.get("_embedded", {})
            return embedded.get("items", [])

    async def get_tour_detail(self, access_token: str, tour_id: str) -> dict:
        """Fetch detailed info for a single tour including coordinates."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{KOMOOT_API_BASE}/tours/{tour_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_routes(
        self,
        access_token: str,
        user_id: str,
        page: int = 0,
        limit: int = 50,
    ) -> list[dict]:
        """Fetch user's planned/saved routes."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{KOMOOT_API_BASE}/users/{user_id}/routes",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"page": page, "limit": limit},
            )
            resp.raise_for_status()
            data = resp.json()
            embedded = data.get("_embedded", {})
            return embedded.get("items", [])

    async def get_route_detail(self, access_token: str, route_id: str) -> dict:
        """Fetch detailed info for a single route including coordinates."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{KOMOOT_API_BASE}/routes/{route_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            return resp.json()


# Singleton
komoot_client = KomootClient()
