"""Schemas for Web Push subscription management."""

from __future__ import annotations

from urllib.parse import urlsplit

from pydantic import BaseModel, field_validator

# Browser push endpoints live on a small set of providers. An allowlist is
# stricter than resolving the host: it also rejects numeric/hex loopback
# spellings (127.1, 2130706433, 0x7f.0.0.1) and single-label Docker DNS names
# without a DNS lookup at validation time.
_ALLOWED_PUSH_HOSTS = (
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "notify.windows.com",
    "web.push.apple.com",
)


def _validate_endpoint(value: str) -> str:
    """Accept only HTTPS endpoints on a known browser push service.

    pywebpush POSTs to whatever endpoint a user registers. Without this guard
    an authenticated user can point it at loopback, link-local metadata, or the
    Docker service network.
    """
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("endpoint must be an https URL with a host")
    if parsed.username or parsed.password:
        raise ValueError("endpoint must not contain credentials")
    if parsed.port not in (None, 443):
        raise ValueError("endpoint must use the default https port")

    host = parsed.hostname.lower()
    if not any(
        host == suffix or host.endswith("." + suffix)
        for suffix in _ALLOWED_PUSH_HOSTS
    ):
        raise ValueError("endpoint host is not a known browser push service")
    return value


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    p256dh: str
    auth: str

    _endpoint = field_validator("endpoint")(_validate_endpoint)


class PushSubscriptionRead(BaseModel):
    id: str
    endpoint: str
    created_at: str | None = None


class PushSubscriptionList(BaseModel):
    subscriptions: list[PushSubscriptionRead]
    count: int


class PushUnregister(BaseModel):
    endpoint: str | None = None
