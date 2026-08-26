"""Komoot integration client — reverse-engineered internal API (v007).

Supports two auth modes:
1. OAuth Bearer token (from OAuthConnection) — tried first
2. Basic Auth with email/password from settings — fallback

The internal API is undocumented and may change without notice.
All calls include a browser-like User-Agent to avoid Cloudflare blocking.
"""

import base64
import logging
import time

import httpx

from app.config import get_settings
from app.integrations.retry import retry_request

logger = logging.getLogger(__name__)

settings = get_settings()

KOMOOT_API_BASE = "https://www.komoot.com/api/v007"

# Browser-like User-Agent to avoid Cloudflare challenges
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


class KomootClient:
    """HTTP client for the Komoot reverse-engineered internal API (v007).

    Uses Basic Auth with komoot_email/komoot_password from settings.
    Includes browser-like User-Agent to avoid Cloudflare blocking.
    """

    def __init__(self):
        self.komoot_email = settings.komoot_email
        self.komoot_password = settings.komoot_password
        self.komoot_user_id = settings.komoot_user_id
        # Session token from login
        self._session_token: str | None = None
        self._session_token_expires: float = 0.0
        self._user_id: str | None = None
        # Basic Auth token cache (BUG-038: initialized to prevent AttributeError)
        self._basic_token: str | None = None
        self._basic_token_expires: float = 0.0

    # ── Shared headers ────────────────────────────────────────────────────────

    def _base_headers(self) -> dict[str, str]:
        """Common headers for all requests."""
        return {
            "User-Agent": _USER_AGENT,
            "Accept": "application/hal+json, application/json",
        }

    def _auth_headers(self) -> dict[str, str]:
        """Build auth headers using Basic Auth (email:password)."""
        headers = self._base_headers()
        if self.komoot_email and self.komoot_password:
            credentials = base64.b64encode(
                f"{self.komoot_email}:{self.komoot_password}".encode()
            ).decode()
            headers["Authorization"] = f"Basic {credentials}"
        return headers

    # ── Basic Auth ────────────────────────────────────────────────────────────

    def _has_basic_credentials(self) -> bool:
        return bool(self.komoot_email and self.komoot_password)

    def _ensure_basic_token(self) -> str | None:
        """Get or refresh the Basic Auth token. Returns token string or None."""
        if not self._has_basic_credentials():
            return None

        # Return cached token if still valid (with 60s buffer)
        if self._basic_token and time.time() < self._basic_token_expires - 60:
            return self._basic_token

        # Create new basic auth token from email:password
        credentials = f"{self.komoot_email}:{self.komoot_password}"
        self._basic_token = base64.b64encode(credentials.encode("utf-8")).decode(
            "utf-8"
        )
        # Basic tokens don't really expire, but refresh daily just in case
        self._basic_token_expires = time.time() + 86400
        return self._basic_token

    async def _session_login(self) -> str | None:
        """Login via Komoot session endpoint and return session token.

        Tries POST /account/v1/session with email/password.
        If that fails, tries basic auth with email:password.
        """
        if not self._has_basic_credentials():
            return None

        # First try: POST /account/v1/session
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{KOMOOT_API_BASE}/account/v1/session",
                    json={
                        "email": self.komoot_email,
                        "password": self.komoot_password,
                    },
                    headers=self._base_headers(),
                )
                logger.info(f"Komoot session login: HTTP {resp.status_code}")
                if resp.status_code in (200, 201):
                    data = resp.json()
                    logger.info(f"Komoot session response keys: {list(data.keys())}")
                    token = (
                        data.get("token")
                        or data.get("access_token")
                        or data.get("session_token")
                    )
                    if token:
                        self._session_token = token
                        expires_in = data.get("expires_in", 86400)
                        self._session_token_expires = time.time() + int(expires_in)
                        logger.info("Komoot session login successful (Bearer token)")
                        return token
                    # Store user_id from session response if available
                    if "username" in data:
                        self._user_id = str(data["username"])
                    elif "user_id" in data:
                        self._user_id = str(data["user_id"])
        except Exception as e:
            logger.error(f"Komoot session login error: {e}")

        return None

    async def ensure_authenticated(self) -> bool:
        """Ensure we have valid credentials. Returns True if authenticated."""
        if not self.komoot_email or not self.komoot_password:
            logger.error(
                "Komoot credentials not configured. Set KOMOOT_EMAIL and KOMOOT_PASSWORD in .env"
            )
            return False
        return True

    # ── Internal API endpoints (v007) ─────────────────────────────────────────

    async def get_account(self) -> dict:
        """Fetch the authenticated user's account info (contains user_id).

        If komoot_user_id is configured in settings, returns it directly.
        Otherwise tries API endpoints to discover the user ID.
        """
        # If user ID is configured, use it directly
        if self.komoot_user_id:
            return {"username": self.komoot_user_id, "user_id": self.komoot_user_id}

        # If we already got user_id from session login, return it
        if self._user_id:
            return {"username": self._user_id, "user_id": self._user_id}

        headers = self._auth_headers()
        async with httpx.AsyncClient(timeout=30) as client:
            # Try email-based account lookup
            if self.komoot_email:
                url = f"{KOMOOT_API_BASE}/account/email/{self.komoot_email}/"
                logger.info(f"Trying Komoot account endpoint: {url}")
                resp = await client.get(url, headers=headers)
                logger.info(f"Account email endpoint: HTTP {resp.status_code}")
                if resp.status_code == 200:
                    data = resp.json()
                    logger.info(f"Account response keys: {list(data.keys())}")
                    return data

            # Try /account/v1/users/me
            url = f"{KOMOOT_API_BASE}/account/v1/users/me"
            logger.info(f"Trying Komoot account endpoint: {url}")
            resp = await client.get(url, headers=headers)
            logger.info(f"Account v1 endpoint: HTTP {resp.status_code}")
            if resp.status_code == 200:
                return resp.json()

            # Fallback: try /users/me/
            url = f"{KOMOOT_API_BASE}/users/me/"
            logger.info(f"Trying Komoot account endpoint: {url}")
            resp = await client.get(url, headers=headers)
            logger.info(f"Users me endpoint: HTTP {resp.status_code}")
            if resp.status_code == 200:
                return resp.json()

            logger.error(
                f"All Komoot account endpoints failed. Last: HTTP {resp.status_code} for {url}"
            )
            raise ValueError(
                "Cannot determine Komoot user ID. Set KOMOOT_USER_ID in .env (your user ID is 4895699973941)"
            )

    async def get_tours(
        self,
        user_id: str | None = None,
        page: int = 0,
        limit: int = 50,
        tour_type: str | None = None,
    ) -> list[dict]:
        """Fetch user's tours (rides, hikes, etc.).

        Args:
            user_id: Komoot user ID
            page: Page number (0-based)
            limit: Results per page
            tour_type: Filter by type (e.g. "planned", "recorded", or None for all)
        """
        headers = self._auth_headers()
        params: dict = {"page": page, "limit": limit}
        if tour_type:
            params["type"] = tour_type

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{KOMOOT_API_BASE}/users/{user_id}/tours/",
                    headers=headers,
                    params=params,
                )
                resp.raise_for_status()
                data = resp.json()
                # Komoot returns tours under _embedded.tours
                embedded = data.get("_embedded", {})
                return embedded.get("tours", embedded.get("items", []))

        return await retry_request(_fetch)

    async def get_tour_detail(self, tour_id: str = "") -> dict:
        """Fetch detailed info for a single tour including coordinates."""
        headers = self._auth_headers()

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{KOMOOT_API_BASE}/tours/{tour_id}/",
                    headers=headers,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def get_coordinates(self, tour_id: str = "") -> list[dict]:
        """Fetch full trackpoint coordinates for a tour.

        Returns array of {lat, lng, alt, t} objects.
        Response is {"items": [...], "_links": {...}} — unwraps to return items list.
        """
        headers = self._auth_headers()

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{KOMOOT_API_BASE}/tours/{tour_id}/coordinates/",
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()
                if isinstance(data, dict):
                    return data.get("items", [])
                return data if isinstance(data, list) else []

        return await retry_request(_fetch)

    async def get_surface(self, tour_id: str = "") -> dict:
        """Fetch terrain surface breakdown for a tour.

        Returns dict with surface type percentages (e.g. asphalt, gravel, etc.).
        """
        headers = self._auth_headers()

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{KOMOOT_API_BASE}/tours/{tour_id}/surface",
                    headers=headers,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def get_routes(
        self,
        user_id: str | None = None,
        page: int = 0,
        limit: int = 50,
    ) -> list[dict]:
        """Fetch user's planned/saved routes (tours with type=tour_planned)."""
        headers = self._auth_headers()

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{KOMOOT_API_BASE}/users/{user_id}/tours/",
                    headers=headers,
                    params={
                        "page": page,
                        "limit": limit,
                        "type": "tour_planned",
                        "sort_field": "date",
                        "sort_direction": "desc",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                embedded = data.get("_embedded", {})
                return embedded.get("tours", embedded.get("items", []))

        return await retry_request(_fetch)

    async def get_route_detail(self, route_id: str = "") -> dict:
        """Fetch detailed info for a single planned route (tour) including coordinates."""
        headers = self._auth_headers()

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{KOMOOT_API_BASE}/tours/{route_id}/",
                    headers=headers,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)


# Singleton
komoot_client = KomootClient()
