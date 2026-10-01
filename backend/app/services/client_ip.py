"""Resolve the real client IP when the API runs behind a trusted proxy.

Every deployment puts a single trusted reverse proxy (Caddy) in front of the
backend, and the backend itself is never published publicly. ``X-Forwarded-For``
is therefore honoured only when the immediate TCP peer is a trusted proxy, and
only its right-most entry is used — that entry is the address the proxy itself
observed, so a client cannot spoof it by sending its own header value.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache

from fastapi import Request

from app.config import get_settings

Network = ipaddress.IPv4Network | ipaddress.IPv6Network


@lru_cache(maxsize=8)
def parse_trusted_networks(raw: str) -> tuple[Network, ...]:
    """Parse a comma-separated list of IPs/CIDRs, ignoring malformed entries."""
    networks: list[Network] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            networks.append(ipaddress.ip_network(part, strict=False))
        except ValueError:
            continue
    return tuple(networks)


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


def _peer_is_trusted(peer: str, networks: tuple[Network, ...]) -> bool:
    try:
        address = ipaddress.ip_address(peer)
    except ValueError:
        return False
    return any(address in network for network in networks)


def resolve_client_ip(
    peer: str | None,
    forwarded_for: str | None,
    trusted_networks: tuple[Network, ...],
) -> str:
    """Return the client IP, trusting ``X-Forwarded-For`` only via a proxy."""
    peer = peer or "unknown"
    if forwarded_for and _peer_is_trusted(peer, trusted_networks):
        # The proxy appends the address it observed, so the right-most entry
        # is the real client; anything a client prepended is ignored.
        candidate = forwarded_for.split(",")[-1].strip()
        if _is_ip(candidate):
            return candidate
    return peer


def get_client_ip(request: Request) -> str:
    """Client IP for rate limiting, accounting for the trusted proxy."""
    networks = parse_trusted_networks(get_settings().trusted_proxies)
    return resolve_client_ip(
        request.client.host if request.client else None,
        request.headers.get("x-forwarded-for"),
        networks,
    )
