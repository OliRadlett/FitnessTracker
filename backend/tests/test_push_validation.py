"""Web Push endpoints must be public HTTPS URLs."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.push import PushSubscriptionCreate


def _subscription(endpoint: str) -> PushSubscriptionCreate:
    return PushSubscriptionCreate(
        endpoint=endpoint, p256dh="key", auth="auth"
    )


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/wp/abc",
        "https://127.0.0.1/push",
        "https://169.254.169.254/latest/meta-data",
        "https://localhost/push",
        "https://backend:8000/push",
        "https://127.1/push",
        "https://2130706433/push",
        "https://0x7f.0.0.1/push",
        "https://caddy/push",
        "https://user:pass@fcm.googleapis.com/wp/abc",
    ],
)
def test_endpoint_rejects_non_public_or_insecure_targets(endpoint: str):
    with pytest.raises(ValidationError):
        _subscription(endpoint)


def test_endpoint_accepts_a_public_push_service():
    assert _subscription("https://fcm.googleapis.com/wp/abc").endpoint.endswith(
        "/abc"
    )
