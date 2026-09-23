"""Withings integration client — body composition scales (BIA).

Uses the Withings API at wbsapi.withings.net/v2.
Auth is via OAuth2 access token (scopes: user.info,user.metrics).

Working endpoints:
    POST /measure?action=getmeas   — body measurements (grouped by grpid)
    POST /oauth2 (action=refresh)  — token refresh (non-standard body param)
    GET  /user?action=getbyuserid   — user info (optional)

Measurement value encoding: actual_value = value * 10^unit
(e.g. value=7463, unit=-2 → 74.63 kg).

Measurement type IDs:
    1   Weight (kg)            — all scales
    4   Height (m)             — all scales
    5   Fat Free Mass (kg)     — Body+, Body Smart, Body Comp, Body Scan
    6   Fat Ratio (%)          — Body+, Body Smart, Body Comp, Body Scan
    8   Fat Mass (kg)          — Body+, Body Smart, Body Comp, Body Scan
    11  Heart Pulse (bpm)      — Body Cardio, Body Smart, Body Scan
    76  Muscle Mass (kg)       — Body+, Body Smart, Body Comp, Body Scan
    77  Hydration (%)          — Body+, Body Smart, Body Comp, Body Scan
    88  Bone Mass (kg)         — Body+, Body Smart, Body Comp, Body Scan
    170 Visceral Fat Index (—) — Body Smart, Body Comp, Body Scan
"""

import logging

import httpx

from app.config import get_settings
from app.integrations.retry import retry_request

logger = logging.getLogger(__name__)

settings = get_settings()

WITHINGS_API_BASE = "https://wbsapi.withings.net/v2"
WITHINGS_AUTH_URL = "https://account.withings.com/oauth2_user/authorize2"
WITHINGS_TOKEN_URL = f"{WITHINGS_API_BASE}/oauth2"

# Measurement types we request from getmeas (category=1, real measurements).
WITHINGS_MEASTYPES = "1,5,6,8,76,77,88,170"


class WithingsClient:
    """HTTP client for the Withings API v2."""

    BASE_URL = WITHINGS_API_BASE

    def __init__(self):
        self.client_id = settings.withings_client_id
        self.client_secret = settings.withings_client_secret

    def _headers(self, access_token: str) -> dict:
        return {"Authorization": f"Bearer {access_token}"}

    async def get_measurements(
        self,
        access_token: str,
        startdate: int | None = None,
        enddate: int | None = None,
        meastypes: str = WITHINGS_MEASTYPES,
        category: int = 1,
    ) -> dict:
        """Fetch body measurements grouped by weighing session (grpid).

        Args:
            access_token: OAuth2 bearer token.
            startdate/enddate: Unix timestamps bounding the query window.
            meastypes: Comma-separated Withings type IDs.
            category: 1 = real measurements (vs 2 = user-entered goals).

        Returns the raw API body: {"status": 0, "body": {"measuregrps": [...]}}.
        """
        form: dict = {
            "action": "getmeas",
            "category": str(category),
            "meastypes": meastypes,
        }
        if startdate is not None:
            form["startdate"] = str(int(startdate))
        if enddate is not None:
            form["enddate"] = str(int(enddate))

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{self.BASE_URL}/measure",
                    data=form,
                    headers=self._headers(access_token),
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    async def get_user_info(self, access_token: str) -> dict:
        """Fetch the authenticated Withings user id (for provider_user_id)."""

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{self.BASE_URL}/user",
                    params={"action": "getbyuserid"},
                    headers=self._headers(access_token),
                )
                resp.raise_for_status()
                return resp.json()

        return await retry_request(_fetch)

    def normalize_token_response(self, data: dict) -> dict:
        """Flatten a Withings token response.

        The oauth2 endpoint nests tokens under ``body``::

            {"status": 0, "body": {"access_token": ..., "refresh_token": ...,
                                   "expires_in": ..., "userid": ...}}

        while callers expect them top-level. Merges ``body`` up when the
        top-level has no ``access_token``. Passes anything else through
        untouched (including error payloads).
        """
        if not isinstance(data, dict):
            return data
        if "access_token" in data:
            return data
        nested = data.get("body")
        if isinstance(nested, dict):
            return {**data, **nested}
        return data

    async def refresh_access_token(self, refresh_token: str) -> dict:
        """Refresh an expired Withings OAuth2 access token.

        Withings uses a non-standard refresh: POST /oauth2 with
        ``action=refresh`` in the form body.

        Returns: {"access_token": str, "refresh_token": str, "expires_in": int, ...}
        The API nests these either top-level or under ``body`` — normalize both.
        """
        from app.integrations.errors import PermanentAuthError, TransientSyncError

        async def _fetch():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    WITHINGS_TOKEN_URL,
                    data={
                        "action": "refresh",
                        "grant_type": "refresh_token",
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "refresh_token": refresh_token,
                    },
                    headers={"Accept": "application/json"},
                )
                if resp.status_code in (400, 401, 403):
                    # Invalid/expired grant — never retryable.
                    raise PermanentAuthError(
                        f"Withings token refresh rejected (HTTP {resp.status_code})"
                    )
                resp.raise_for_status()
                return resp.json()

        data = await retry_request(_fetch)
        normalized = self.normalize_token_response(data)

        # Withings reports errors as HTTP 200 with a non-zero ``status`` and no
        # access token. Only explicit auth failures (invalid_grant / revoked /
        # unknown refresh token) are permanent — everything else (e.g. 2554
        # "Unspecified unknown error", 601 too-many-requests, 503) is
        # transient so a later run retries instead of forcing a manual
        # re-authorisation for what was a server-side blip.
        if "access_token" not in normalized and normalized.get("status") not in (
            None,
            0,
        ):
            err_text = str(normalized.get("error", "")).lower()
            status = normalized.get("status")
            permanent_signals = (
                "invalid_grant",
                "invalid grant",
                "revoked",
                "invalid refresh",
                "unknown refresh",
                "unauthorized",
            )
            if any(sig in err_text for sig in permanent_signals) or status in (
                283,
                343,
            ):
                raise PermanentAuthError(
                    f"Withings token refresh failed "
                    f"(status {status}): "
                    f"{normalized.get('error', 'unknown error')}"
                )
            raise TransientSyncError(
                f"Withings token refresh transient failure "
                f"(status {status}): "
                f"{normalized.get('error', 'unknown error')}"
            )
        return normalized


# Singleton
withings_client = WithingsClient()
