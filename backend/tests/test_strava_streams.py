"""Which activity streams we ask Strava for, and why that list is a contract.

Two independent reasons the list cannot be trimmed casually.

**Full GPS is not optional.** The climb matcher cannot recover a 1 km climb from a
56–111 km summary polyline (an experiment recovered 9 of 38 known efforts), so
``latlng`` has to be in the request. ``services/replay.py`` reads it too: without
it every Strava ride falls back to interpolating the route polyline, which is a
*shape* — switchbacks flattened, and any part of the ride that left the matched
route smoothed away.

**``keys`` is comma-separated**, so an extra stream type costs *no extra API call*
— only bytes. The usual "is this worth a request?" test therefore does not apply;
the question is whether anything will read the data. ``temp`` and ``grade_smooth``
are deliberately absent for that reason, and the absence is asserted so adding
them is a decision rather than a drift.
"""

from __future__ import annotations

import httpx
import pytest

from app.integrations.strava_client import (
    DEFAULT_STREAM_TYPES,
    StravaClient,
    stream_keys,
)

# Everything the analytics pipeline already depends on.
_REQUIRED = {
    "time",  # the time axis: sample spacing is not uniform
    "heartrate",
    "watts",
    "cadence",
    "altitude",
    "velocity_smooth",
    "distance",  # exact segment alignment; velocity integration drifts
}


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
    """The request itself carries latlng — no network, just the keys we send."""
    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    client = StravaClient()

    streams = await client.get_activity_streams("token", 123)

    assert "latlng" in streams
    assert _FakeClient.captured is not None
    keys = _FakeClient.captured["params"]["keys"].split(",")
    assert "latlng" in keys
    # The existing consumers still get their streams.
    assert {"distance", "time", "altitude", "watts"} <= set(keys)


class TestDefaultStreams:
    def test_keeps_the_streams_the_pipeline_depends_on(self):
        assert _REQUIRED <= set(DEFAULT_STREAM_TYPES)

    def test_requests_latlng_for_segment_matching_and_replay(self):
        assert "latlng" in DEFAULT_STREAM_TYPES

    def test_does_not_collect_streams_nothing_reads(self):
        """`temp` and `grade_smooth` have no consumer yet.

        This is not a rule that they can never be added — it is a rule that they
        are added *with* the reader, in the same change. Deleting an assertion
        here is the visible act of making that decision.
        """
        unused = {"temp", "grade_smooth", "moving"}
        assert unused.isdisjoint(DEFAULT_STREAM_TYPES)

    def test_no_duplicates(self):
        assert len(DEFAULT_STREAM_TYPES) == len(set(DEFAULT_STREAM_TYPES))


class TestStreamKeys:
    def test_defaults_to_the_module_list(self):
        keys = stream_keys()
        assert keys.split(",") == list(DEFAULT_STREAM_TYPES)

    def test_explicit_list_replaces_the_default(self):
        """The endpoint has no additive mode — an explicit list must not merge."""
        assert stream_keys(["watts"]) == "watts"

    @pytest.mark.parametrize("explicit", [["watts"], ["watts", "heartrate"]])
    def test_explicit_list_never_leaks_latlng(self, explicit):
        assert "latlng" not in stream_keys(explicit).split(",")
