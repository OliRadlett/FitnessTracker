"""Wahoo integration client — OAuth, routes/workouts fetch + push."""

import base64
import json
import logging
from datetime import date, datetime

import httpx

from app.config import get_settings
from app.integrations.retry import retry_request

logger = logging.getLogger(__name__)

settings = get_settings()

WAHOO_API_BASE = "https://api.wahooligan.com"
WAHOO_AUTH_URL = f"{WAHOO_API_BASE}/oauth/authorize"
WAHOO_TOKEN_URL = f"{WAHOO_API_BASE}/oauth/token"

# Wahoo workout type family / location enums
WAHOO_FAMILY_BIKING = 0
WAHOO_LOCATION_INDOOR = 0
WAHOO_LOCATION_OUTDOOR = 1
WAHOO_TYPE_BIKING_OUTDOOR = 0
# 12 = BIKING_INDOOR, 13 = BIKING_MOUNTAIN (this constant read 13 previously).
WAHOO_TYPE_BIKING_INDOOR = 12
WAHOO_TYPE_BIKING_MOUNTAIN = 13

# Wahoo daycodes are days since 2020-01-01 (daycode 1 == 2020-01-01)
_WAHOO_DAYCODE_EPOCH = date(2020, 1, 1)


def wahoo_daycode(d: date) -> int:
    """Convert a date to a Wahoo daycode (days since 1 Jan 2020, where 1/1/2020 = 1)."""
    return (d - _WAHOO_DAYCODE_EPOCH).days + 1


def _iso_z(dt: datetime) -> str:
    """Format a datetime as Wahoo's ISO8601 millisecond UTC string."""
    from datetime import UTC

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _as_list(payload, key: str) -> list[dict]:
    """Normalise a bare list / dict-wrapped list response into a list of dicts."""
    if isinstance(payload, dict):
        payload = payload.get(key, payload.get("data", []))
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _first_item(payload, key: str) -> dict | None:
    """Normalise a list / dict-wrapped list response and return the first dict."""
    items = _as_list(payload, key)
    return items[0] if items else None


class WahooClient:
    """HTTP client for the Wahoo Cloud API."""

    def __init__(self):
        self.client_id = settings.wahoo_client_id
        self.client_secret = settings.wahoo_client_secret

    def get_authorize_url(self, redirect_uri: str) -> str:
        """Build Wahoo OAuth authorize URL.

        Must mirror the scope set requested in ``services/auth.py`` and match
        the scopes approved for the app in the Wahoo developer portal —
        requesting an unapproved scope fails the authorize step.
        """
        scopes = (
            "email+user_read+user_write"
            "+power_zones_read+power_zones_write"
            "+workouts_read+workouts_write"
            "+plans_read+plans_write"
            "+routes_read+routes_write+offline_data"
        )
        return (
            f"{WAHOO_AUTH_URL}?"
            f"client_id={self.client_id}&redirect_uri={redirect_uri}"
            f"&response_type=code&scope={scopes}"
        )

    async def exchange_code(self, code: str, redirect_uri: str) -> dict:
        """Exchange authorization code for tokens."""

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
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

        return await retry_request(_fetch)

    async def refresh_access_token(self, refresh_token: str) -> dict:
        """Refresh an expired Wahoo access token."""

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
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

        return await retry_request(_fetch)

    async def get_user(self, access_token: str) -> dict:
        """Fetch the authenticated user profile."""
        async with httpx.AsyncClient(timeout=30) as client:
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
            async with httpx.AsyncClient(timeout=30) as client:
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
            async with httpx.AsyncClient(timeout=30) as client:
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
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{WAHOO_API_BASE}/v1/workouts",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"page": page, "per_page": per_page},
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    # ── Plans (structured workout definitions) ───────────────────────────────

    async def find_plan_by_external_id(
        self, access_token: str, external_id: str
    ) -> dict | None:
        """Return the plan with a matching external_id, or None."""

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{WAHOO_API_BASE}/v1/plans",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"external_id": external_id},
                )
                resp.raise_for_status()
                return resp.json()

        return _first_item(await retry_request(_fetch), "plans")

    async def create_plan(
        self,
        access_token: str,
        plan_json: dict | str,
        external_id: str,
        provider_updated_at: str,
        filename: str = "plan.json",
    ) -> dict:
        """Upload a structured workout plan file to the user's library."""
        body = (
            plan_json
            if isinstance(plan_json, str)
            else json.dumps(plan_json, separators=(",", ":"))
        )
        encoded = base64.b64encode(body.encode()).decode()
        data = {
            "plan[file]": f"data:application/json;base64,{encoded}",
            "plan[filename]": filename,
            "plan[external_id]": external_id,
            "plan[provider_updated_at]": provider_updated_at,
        }

        async def _fetch():
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{WAHOO_API_BASE}/v1/plans",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                    data=data,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def update_plan(
        self,
        access_token: str,
        plan_id: int,
        plan_json: dict | str,
        provider_updated_at: str,
        filename: str = "plan.json",
    ) -> dict:
        """Update an existing plan in the user's library."""
        body = (
            plan_json
            if isinstance(plan_json, str)
            else json.dumps(plan_json, separators=(",", ":"))
        )
        encoded = base64.b64encode(body.encode()).decode()
        data = {
            "plan[file]": f"data:application/json;base64,{encoded}",
            "plan[filename]": filename,
            "plan[provider_updated_at]": provider_updated_at,
        }

        async def _fetch():
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.put(
                    f"{WAHOO_API_BASE}/v1/plans/{plan_id}",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                    data=data,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def delete_plan(self, access_token: str, plan_id: int) -> None:
        """Delete a plan from the user's library."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.delete(
                f"{WAHOO_API_BASE}/v1/plans/{plan_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()

    # ── Power zones ──────────────────────────────────────────────────────────
    #
    # Wahoo's zone model is *one anchor plus derived boundaries per sport profile*
    # (plan §3.3): the payload carries `ftp` plus `zone_1..zone_7`. The docs' own
    # example sends `zone_1..zone_7` with `zone_count=8`, so the convention for
    # `zone_N` (lower bound? upper? centre?) is not pinned down by the
    # documentation alone — `plans/wahoo-zone-sync.md` §11 settles it against a
    # sandbox. The service meanwhile rescales a set's *own* values by ratio, which
    # preserves whatever the convention turns out to be, so the write path does not
    # depend on the answer.
    #
    # Note the documented docs bug: the "Update a Power Zone" section's HTTP Request
    # line says `POST /v1/power_zones` while its own curl (and the OpenAPI mirror)
    # say `PUT /v1/power_zones/{id}`. The curl is authoritative.

    async def get_power_zones(self, access_token: str) -> list[dict]:
        """Fetch the athlete's power zone sets."""

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{WAHOO_API_BASE}/v1/power_zones",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                resp.raise_for_status()
                return resp.json()

        return _as_list(await retry_request(_fetch), "power_zones")

    async def create_power_zone(self, access_token: str, payload: dict) -> dict:
        """Create a power zone set; returns Wahoo's record (including ``id``)."""
        data = {
            f"power_zone[{key}]": str(value)
            for key, value in payload.items()
            if value is not None
        }

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{WAHOO_API_BASE}/v1/power_zones",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                    data=data,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def update_power_zone(
        self, access_token: str, zone_id: int, payload: dict
    ) -> dict:
        """Update an existing power zone set."""
        data = {
            f"power_zone[{key}]": str(value)
            for key, value in payload.items()
            if value is not None
        }

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.put(
                    f"{WAHOO_API_BASE}/v1/power_zones/{zone_id}",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                    data=data,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def delete_power_zone(self, access_token: str, zone_id: int) -> None:
        """Delete a power zone set."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.delete(
                f"{WAHOO_API_BASE}/v1/power_zones/{zone_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()

    # ── Routes (FIT course upload) ───────────────────────────────────────────

    async def find_route_by_external_id(
        self, access_token: str, external_id: str
    ) -> dict | None:
        """Return the route with a matching external_id, or None."""

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{WAHOO_API_BASE}/v1/routes",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"external_id": external_id},
                )
                resp.raise_for_status()
                return resp.json()

        return _first_item(await retry_request(_fetch), "routes")

    @staticmethod
    def _route_form(
        fit_bytes: bytes, meta: dict, *, include_file: bool = True
    ) -> dict:
        data: dict[str, str] = {}
        if include_file:
            encoded = base64.b64encode(fit_bytes).decode()
            data["route[file]"] = f"data:application/vnd.fit;base64,{encoded}"
            data["route[filename]"] = meta.get("filename", "route.fit")
        for key in (
            "external_id",
            "provider_updated_at",
            "name",
            "description",
            "workout_type_family_id",
            "start_lat",
            "start_lng",
            "distance",
            "ascent",
            "descent",
        ):
            value = meta.get(key)
            if value is not None:
                data[f"route[{key}]"] = str(value)
        return data

    async def create_route(
        self, access_token: str, fit_bytes: bytes, meta: dict
    ) -> dict:
        """Upload a route (FIT course) to the user's Wahoo library."""
        data = self._route_form(fit_bytes, meta, include_file=True)

        async def _fetch():
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{WAHOO_API_BASE}/v1/routes",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                    data=data,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def update_route(
        self, access_token: str, route_id: int, fit_bytes: bytes, meta: dict
    ) -> dict:
        """Update a route in the user's Wahoo library."""
        data = self._route_form(fit_bytes, meta, include_file=True)

        async def _fetch():
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.put(
                    f"{WAHOO_API_BASE}/v1/routes/{route_id}",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                    data=data,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def delete_route(self, access_token: str, route_id: int) -> None:
        """Delete a route from the user's Wahoo library."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.delete(
                f"{WAHOO_API_BASE}/v1/routes/{route_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()

    # ── Workouts (scheduled instances) ───────────────────────────────────────

    async def create_workout(self, access_token: str, payload: dict) -> dict:
        """Create a scheduled workout (optionally attached to a plan/route)."""
        data = {
            f"workout[{key}]": str(value)
            for key, value in payload.items()
            if value is not None
        }

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{WAHOO_API_BASE}/v1/workouts",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                    data=data,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def update_workout(
        self, access_token: str, workout_id: int, payload: dict
    ) -> dict:
        """Update a scheduled workout."""
        data = {
            f"workout[{key}]": str(value)
            for key, value in payload.items()
            if value is not None
        }

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.put(
                    f"{WAHOO_API_BASE}/v1/workouts/{workout_id}",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                    data=data,
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def delete_workout(self, access_token: str, workout_id: int) -> None:
        """Delete a scheduled workout."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.delete(
                f"{WAHOO_API_BASE}/v1/workouts/{workout_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()


# Singleton
wahoo_client = WahooClient()
