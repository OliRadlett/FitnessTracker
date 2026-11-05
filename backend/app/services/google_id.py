"""Verify Google ID tokens for native clients.

The Android app signs in with Credential Manager, which returns a Google ID
token — a JWT signed by Google. This module checks it without trusting the
client: signature against Google's published JWKS, audience, issuer, expiry and
a verified email. A client that forges a token gets nowhere.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from jose import jwk, jwt
from jose.exceptions import JWTError

logger = logging.getLogger(__name__)

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})
CACHE_TTL_SECONDS = 3600

_cache: dict[str, Any] | None = None
_cache_at: float = 0.0


class GoogleTokenError(Exception):
    """The token is not a valid Google ID token for this application."""


def _reset_cache() -> None:
    global _cache, _cache_at
    _cache = None
    _cache_at = 0.0


def _install_keys(keys: dict[str, Any]) -> None:
    """Test seam: install a JWKS without a network call."""
    global _cache, _cache_at
    _cache = keys
    _cache_at = time.time()


async def _fetch_keys() -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(GOOGLE_CERTS_URL)
        resp.raise_for_status()
        payload = resp.json()

    keys: dict[str, Any] = {}
    for entry in payload.get("keys", []):
        kid = entry.get("kid")
        if kid:
            keys[kid] = entry
    if not keys:
        raise GoogleTokenError("Google published no signing keys")
    return keys


async def _keys(force: bool = False) -> dict[str, Any]:
    global _cache, _cache_at
    if not force and _cache is not None and time.time() - _cache_at < CACHE_TTL_SECONDS:
        return _cache
    _cache = await _fetch_keys()
    _cache_at = time.time()
    return _cache


async def verify_google_id_token(token: str, audience: str) -> dict[str, Any]:
    """Return the token's claims, or raise GoogleTokenError.

    Checks, in order: shape, algorithm, signing key, signature, expiry,
    audience, issuer, and that the email is present and verified.
    """
    if not token:
        raise GoogleTokenError("Missing ID token")

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise GoogleTokenError("Malformed ID token") from exc

    if header.get("alg") != "RS256":
        raise GoogleTokenError("Unexpected token algorithm")

    kid = header.get("kid")
    if not kid:
        raise GoogleTokenError("Token has no key id")

    entry = (await _keys()).get(kid)
    if entry is None:
        # Google rotates signing keys; a miss may just mean our cache is stale.
        entry = (await _keys(force=True)).get(kid)
    if entry is None:
        raise GoogleTokenError("Signing key not recognised")

    key = jwk.construct(entry, algorithm="RS256")
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=audience,
            options={"verify_iss": False},
        )
    except JWTError as exc:
        raise GoogleTokenError(
            "Signature, audience or expiry check failed"
        ) from exc

    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise GoogleTokenError("Unexpected issuer")
    if not claims.get("email"):
        raise GoogleTokenError("Token carries no email")
    if claims.get("email_verified") is False:
        raise GoogleTokenError("Email is not verified")

    return claims
