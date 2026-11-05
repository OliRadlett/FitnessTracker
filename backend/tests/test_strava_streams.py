"""The Strava stream request must include full GPS (``latlng``).

The climb matcher cannot recover a 1 km climb from a 56–111 km summary polyline
(9/38 known efforts), so sample-level GPS is not optional. This is a regression
test on the request keys, not on the network.
"""

from __future__ import annotations

import httpx

from app.integrations.strava_client import StravaClient


class _FakeResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self):
        return [{"type": "latlng", "data": [[55.9, -3.2]]}]


class _FakeClient:
    captured: dict | None = None

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args) -> None:
        return None

    async def get(self, url, headers=None, params=None):
        _FakeClient.captured = {"url": url, "headers": headers, "params": params}
        return _FakeResponse()


async def test_activity_streams_request_latlng(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    client = StravaClient()

    streams = await client.get_activity_streams("token", 123)

    assert "latlng" in streams
    assert _FakeClient.captured is not None
    keys = _FakeClient.captured["params"]["keys"].split(",")
    assert "latlng" in keys
    # The existing consumers still get their streams.
    assert {"distance", "time", "altitude", "watts"} <= set(keys)
