"""Trusted-proxy client-IP resolution for the auth rate limiter (S4).

The backend runs behind a single trusted reverse proxy (Caddy). The rate
limiter must key on the real client address rather than the proxy's, while
never letting a client spoof its own address via ``X-Forwarded-For``.
"""

from fastapi.responses import Response as FastAPIResponse
from starlette.requests import Request

from app.services.client_ip import (
    get_client_ip,
    parse_trusted_networks,
    resolve_client_ip,
)

TRUSTED = parse_trusted_networks(
    "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
)

PROXY_PEER = "172.18.0.5"  # Caddy, on the compose bridge network
CLIENT_IP = "203.0.113.9"  # the real client, as seen by Caddy


def test_trusted_peer_uses_rightmost_forwarded_entry():
    # The attacker's value comes first; the proxy appends the real client.
    forwarded = f"1.1.1.1, {CLIENT_IP}"
    assert resolve_client_ip(PROXY_PEER, forwarded, TRUSTED) == CLIENT_IP


def test_untrusted_peer_ignores_forwarded_for():
    assert resolve_client_ip(CLIENT_IP, "1.1.1.1", TRUSTED) == CLIENT_IP


def test_trusted_peer_without_header_returns_peer():
    assert resolve_client_ip(PROXY_PEER, None, TRUSTED) == PROXY_PEER


def test_missing_peer_returns_unknown():
    assert resolve_client_ip(None, "1.1.1.1", TRUSTED) == "unknown"


def test_blank_forwarded_for_falls_back_to_peer():
    assert resolve_client_ip(PROXY_PEER, "  ,  ", TRUSTED) == PROXY_PEER


def test_non_ip_forwarded_entry_falls_back_to_peer():
    assert resolve_client_ip(PROXY_PEER, "not-an-ip", TRUSTED) == PROXY_PEER


def test_malformed_trusted_entries_are_ignored():
    nets = parse_trusted_networks("bogus, 172.18.0.0/16, ,10.0.0.0/8")
    assert resolve_client_ip("172.18.9.9", CLIENT_IP, nets) == CLIENT_IP
    assert resolve_client_ip(CLIENT_IP, "1.1.1.1", nets) == CLIENT_IP


def test_ipv6_loopback_is_trusted():
    assert resolve_client_ip("::1", CLIENT_IP, TRUSTED) == CLIENT_IP


def _request(peer: str | None, forwarded_for: str | None = None) -> Request:
    headers = [(b"host", b"localhost")]
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/auth/sync-user",
            "query_string": b"",
            "scheme": "https",
            "server": ("localhost", 443),
            "headers": headers,
            "client": (peer, 12345) if peer else None,
        }
    )


def test_default_config_trusts_docker_peer():
    assert get_client_ip(_request(PROXY_PEER, CLIENT_IP)) == CLIENT_IP


def test_default_config_trusts_loopback_peer():
    assert get_client_ip(_request("127.0.0.1", CLIENT_IP)) == CLIENT_IP


def test_default_config_ignores_header_from_public_peer():
    assert get_client_ip(_request(CLIENT_IP, "1.1.1.1")) == CLIENT_IP


async def test_auth_middleware_keys_on_real_client_ip(monkeypatch):
    from app import main

    seen: dict[str, str] = {}

    async def fake_check_rate_limit(key, limit, window_seconds=60):
        seen["key"] = key
        return True

    monkeypatch.setattr(
        "app.services.cache.check_rate_limit", fake_check_rate_limit
    )

    async def call_next(_request: Request) -> FastAPIResponse:
        return FastAPIResponse()

    response = await main.auth_rate_limit_middleware(
        _request(PROXY_PEER, CLIENT_IP), call_next
    )

    assert response.status_code == 200
    assert seen["key"] == f"auth:{CLIENT_IP}"
