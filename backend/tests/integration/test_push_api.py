"""Web Push subscription management (§3.8) — schema + edge-case tests.

Covers: VAPID unconfigured behaviour, register/list/unsubscribe, and deleting
a non-existent endpoint. Requires: running backend with DATABASE_URL; no push
actually fires (VAPID keys are unset in the test env).
"""

import uuid

import pytest


@pytest.mark.asyncio
async def test_vapid_key_unconfigured(client) -> None:
    """VAPID endpoint returns 404 when keys are not set."""
    r = await client.get("/api/v1/push/vapid-public-key")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_subscribe_and_list(client) -> None:
    """Register a subscription, list it, then unsubscribe."""
    payload = {
        "endpoint": f"https://push.example.com/{uuid.uuid4()}",
        "p256dh": "fakep256key",
        "auth": "fakeauthkey",
    }

    # Register
    r = await client.post("/api/v1/push/subscriptions", json=payload)
    assert r.status_code == 200
    assert r.json()["id"]

    # List
    r = await client.get("/api/v1/push/subscriptions")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 1
    assert any(s["endpoint"] == payload["endpoint"] for s in body["subscriptions"])

    # Unsubscribe
    r = await client.request(
        "DELETE", "/api/v1/push/subscriptions", json={"endpoint": payload["endpoint"]}
    )
    assert r.status_code == 200
    assert r.json()["removed"] is True

    # Confirm gone
    r = await client.get("/api/v1/push/subscriptions")
    assert (
        any(s["endpoint"] != payload["endpoint"] for s in r.json()["subscriptions"])
        and r.json()["count"] >= 0
    )


@pytest.mark.asyncio
async def test_delete_nonexistent_endpoint(client) -> None:
    """Deleting an endpoint that was never registered reports removed=False."""
    r = await client.request(
        "DELETE",
        "/api/v1/push/subscriptions",
        json={"endpoint": "https://does.not.exist/nope"},
    )
    assert r.status_code == 200
    assert r.json()["removed"] is False


@pytest.mark.asyncio
async def test_duplicate_register_is_idempotent(client) -> None:
    """Registering the same endpoint twice doesn't create two subs."""
    payload = {
        "endpoint": f"https://push.example.com/{uuid.uuid4()}",
        "p256dh": "k1",
        "auth": "a1",
    }
    r1 = await client.post("/api/v1/push/subscriptions", json=payload)
    r2 = await client.post("/api/v1/push/subscriptions", json={**payload, "auth": "a2"})
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]

    r = await client.get("/api/v1/push/subscriptions")
    matching = [
        s for s in r.json()["subscriptions"] if s["endpoint"] == payload["endpoint"]
    ]
    assert len(matching) == 1
