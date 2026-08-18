"""Whoop integration client — Developer API v2.

Uses the Whoop Developer API at api.prod.whoop.com.
Auth is via OAuth access token (read:recovery, read:sleep, read:workout scopes).

Working endpoints:
    GET /developer/v2/cycle                 — daily cycles (strain, HR, kilojoules)
    GET /developer/v2/cycle/{id}            — single cycle detail
    GET /developer/v2/cycle/{id}/recovery   — recovery data for a cycle
    GET /developer/v2/activity/sleep        — sleep activities (paginated)
    GET /developer/v2/activity/workout      — workout activities (paginated)
    GET /developer/v2/user/profile/basic    — user profile
    GET /developer/v2/user/measurement/body — body measurements
"""

import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

WHOOP_API_BASE = "https://api.prod.whoop.com"

# Rate limit retry configuration
_MAX_RETRIES = 3
_INITIAL_BACKOFF_SECONDS = 2.0
_BACKOFF_MULTIPLIER = 2.0


class WhoopClient:
    """HTTP client for the Whoop Developer API v2."""

    def __init__(self, base_url: str = WHOOP_API_BASE):
        self.base_url = base_url

    def _headers(self, access_token: str) -> dict:
        return {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }

    # ── Profile ──────────────────────────────────────────────────────────

    async def get_profile(self, access_token: str) -> dict:
        """Fetch the authenticated user's basic profile.

        Returns: {"user_id": int, "email": str, "first_name": str, "last_name": str}
        """
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/developer/v2/user/profile/basic",
                headers=self._headers(access_token),
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()

    # ── Body measurements ────────────────────────────────────────────────

    async def get_body_measurements(self, access_token: str) -> dict:
        """Fetch body measurements.

        Returns: {"height_meter": float, "weight_kilogram": float, "max_heart_rate": int}
        """
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/developer/v2/user/measurement/body",
                headers=self._headers(access_token),
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()

    # ── Cycles ───────────────────────────────────────────────────────────

    async def get_cycles(
        self,
        access_token: str,
        start: str | None = None,
        end: str | None = None,
        limit: int = 25,
    ) -> dict:
        """Fetch physiological cycles (daily data).

        Each cycle contains: strain, kilojoule, average_heart_rate, max_heart_rate.

        Args:
            access_token: Bearer token from Whoop web app.
            start: ISO 8601 start date/datetime filter.
            end: ISO 8601 end date/datetime filter.
            limit: Max records per page (max 25).

        Returns: {"records": [...], "next_token": str | None}
        """
        params: dict = {"limit": min(limit, 25)}
        if start:
            params["start"] = start
        if end:
            params["end"] = end

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/developer/v2/cycle",
                headers=self._headers(access_token),
                params=params,
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_cycle_detail(self, access_token: str, cycle_id: int) -> dict:
        """Fetch a single cycle by ID.

        Returns: {"id": int, "user_id": int, "start": str, "end": str, "score": {...}, ...}
        """
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/developer/v2/cycle/{cycle_id}",
                headers=self._headers(access_token),
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()

    async def _paginated_get(
        self,
        access_token: str,
        endpoint: str,
        start: str | None = None,
        end: str | None = None,
        max_records: int = 500,
        label: str = "records",
    ) -> list[dict]:
        """Shared paginated GET with rate limit retry (429) and backoff.

        Follows next_token cursors until all records are fetched or
        max_records is reached. Retries on 429 with exponential backoff.
        """
        all_records: list[dict] = []
        next_token: str | None = None

        while len(all_records) < max_records:
            params: dict = {"limit": 25}
            if start and next_token is None:
                params["start"] = start
            if end and next_token is None:
                params["end"] = end
            if next_token:
                params["nextToken"] = next_token

            # Retry loop for 429 rate limits
            backoff = _INITIAL_BACKOFF_SECONDS
            for attempt in range(_MAX_RETRIES + 1):
                async with httpx.AsyncClient() as client:
                    resp = await client.get(
                        f"{self.base_url}{endpoint}",
                        headers=self._headers(access_token),
                        params=params,
                        timeout=30,
                    )

                if resp.status_code == 429:
                    if attempt < _MAX_RETRIES:
                        retry_after = resp.headers.get("Retry-After")
                        wait = float(retry_after) if retry_after else backoff
                        logger.warning(
                            f"Whoop rate limit hit on {endpoint} (attempt {attempt + 1}/{_MAX_RETRIES}), "
                            f"waiting {wait:.1f}s before retry"
                        )
                        await asyncio.sleep(wait)
                        backoff *= _BACKOFF_MULTIPLIER
                        continue
                    else:
                        logger.error(f"Whoop rate limit exceeded after {_MAX_RETRIES} retries on {endpoint}")
                        resp.raise_for_status()

                resp.raise_for_status()
                break

            data = resp.json()
            records = data.get("records", [])
            all_records.extend(records)

            next_token = data.get("next_token")
            if not next_token or not records:
                break

            if len(all_records) >= max_records:
                all_records = all_records[:max_records]
                break

            # Small delay between pages to be kind to the API
            await asyncio.sleep(0.25)

        logger.info(f"Fetched {len(all_records)} Whoop {label}")
        return all_records

    async def get_all_cycles(
        self,
        access_token: str,
        start: str | None = None,
        end: str | None = None,
        max_records: int = 500,
    ) -> list[dict]:
        """Fetch all cycles with automatic pagination."""
        return await self._paginated_get(
            access_token, "/developer/v2/cycle",
            start=start, end=end, max_records=max_records, label="cycles",
        )

    # ── Recovery ───────────────────────────────────────────────────────────

    async def get_recovery_for_cycle(
        self, access_token: str, cycle_id: int
    ) -> dict | None:
        """Fetch recovery data for a specific cycle.

        Returns: {"cycle_id": int, "recovery_score": float, "hrv_rmssd_milli": float,
                  "resting_heart_rate": int, "respiratory_rate": float, "spo2_percentage": float}
        Returns None if recovery is not yet computed (404).
        """
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{self.base_url}/developer/v2/cycle/{cycle_id}/recovery",
                    headers=self._headers(access_token),
                    timeout=30,
                )
                if resp.status_code == 404:
                    logger.debug(f"Recovery not yet computed for cycle {cycle_id}")
                    return None
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise  # Token expired — propagate
            logger.warning(f"Failed to fetch recovery for cycle {cycle_id}: {e}")
            return None

    # ── Sleep activities ───────────────────────────────────────────────────

    async def get_sleep_activities(
        self,
        access_token: str,
        start: str | None = None,
        end: str | None = None,
        limit: int = 25,
    ) -> dict:
        """Fetch sleep activities (paginated).

        Each record: {"id": int, "start": str, "end": str, "score_state": str,
                       "score": {"total_sleep_time_milli": int, "sleep_efficiency": float,
                                 "slow_wave_sleep_milli": int, "rem_sleep_milli": int,
                                 "light_sleep_milli": int, "awake_time_milli": int}}

        Returns: {"records": [...], "next_token": str | None}
        """
        params: dict = {"limit": min(limit, 25)}
        if start:
            params["start"] = start
        if end:
            params["end"] = end

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/developer/v2/activity/sleep",
                headers=self._headers(access_token),
                params=params,
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_all_sleep_activities(
        self,
        access_token: str,
        start: str | None = None,
        end: str | None = None,
        max_records: int = 500,
    ) -> list[dict]:
        """Fetch all sleep activities with automatic pagination."""
        return await self._paginated_get(
            access_token, "/developer/v2/activity/sleep",
            start=start, end=end, max_records=max_records, label="sleep activities",
        )

    # ── Workout activities ─────────────────────────────────────────────────

    async def get_workout_activities(
        self,
        access_token: str,
        start: str | None = None,
        end: str | None = None,
        limit: int = 25,
    ) -> dict:
        """Fetch workout activities (paginated).

        Each record: {"id": int, "start": str, "end": str, "sport_name": str,
                       "score_state": str, "score": {"strain": float, "average_heart_rate": int,
                       "max_heart_rate": int, "kilojoule": float}}

        Returns: {"records": [...], "next_token": str | None}
        """
        params: dict = {"limit": min(limit, 25)}
        if start:
            params["start"] = start
        if end:
            params["end"] = end

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/developer/v2/activity/workout",
                headers=self._headers(access_token),
                params=params,
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_all_workout_activities(
        self,
        access_token: str,
        start: str | None = None,
        end: str | None = None,
        max_records: int = 500,
    ) -> list[dict]:
        """Fetch all workout activities with automatic pagination."""
        return await self._paginated_get(
            access_token, "/developer/v2/activity/workout",
            start=start, end=end, max_records=max_records, label="workout activities",
        )


    # ── Token refresh ─────────────────────────────────────────────────────

    async def refresh_access_token(
        self,
        client_id: str,
        client_secret: str,
        refresh_token: str,
    ) -> dict:
        """Refresh an expired OAuth2 access token using a refresh token.

        Returns: {"access_token": str, "refresh_token": str, "expires_in": int, ...}
        """
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/oauth/oauth2/token",
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": client_id,
                    "client_secret": client_secret,
                },
                headers={"Accept": "application/json"},
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()


# Singleton
whoop_client = WhoopClient()
