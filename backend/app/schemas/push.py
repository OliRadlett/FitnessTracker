"""Schemas for Web Push subscription management."""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

from pydantic import BaseModel, field_validator


def _validate_endpoint(value: str) -> str:
    """Reject non-HTTPS and local/private targets.

    pywebpush POSTs to whatever endpoint a user registers. Without this guard
    an authenticated user can point it at loopback, link-local metadata, or the
    Docker service network. DNS rebinding is still possible, but the obvious
    SSRF is closed at registration.
    """
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("endpoint must be an https URL with a host")
    if parsed.username or parsed.password:
        raise ValueError("endpoint must not contain credentials")
    if parsed.port not in (None, 443):
        raise ValueError("endpoint must use the default https port")

    host = parsed.hostname.lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith(
        (".localhost", ".local", ".internal", ".home.arpa")
    ):
        raise ValueError("endpoint host is local")

    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return value
    if (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_unspecified
        or address.is_multicast
    ):
        raise ValueError("endpoint host is not public")
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
