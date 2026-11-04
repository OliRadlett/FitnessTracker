"""Tests for the normalized replay builder."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.schemas.replay import ReplayResponse
from app.services.polyline_utils import encode_polyline
from app.services.replay import ReplayUnavailable, build_replay


def _stream(stream_type: str, values: list, resolution: int | None = 1):
    return SimpleNamespace(
        stream_type=stream_type,
        data={"data": values},
        resolution=resolution,
    )


def _activity(streams: list, polyline: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        name="Test Ride",
        start_date=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
        sport_type="cycling",
        source="strava",
        route_id=None,
        route=None,
        duration_seconds=5,
        distance_meters=25.0,
        elevation_gain_meters=25.0,
        average_speed=5.0,
        average_heartrate=125.0,
        average_power=225.0,
        calories=10.0,
        weather_temperature=12.0,
        weather_conditions="Clear",
        weather_wind_speed_kmh=10.0,
        weather_wind_direction_deg=180.0,
        weather_precipitation_mm=0.0,
        raw_data={
            "timezone": "UTC",
            "map": {"summary_polyline": polyline},
        },
        sources=[],
        streams=streams,
    )


def _base_streams() -> tuple[list, str]:
    coords = [
        (46.0, 6.0),
        (46.001, 6.001),
        (46.002, 6.001),
        (46.003, 6.002),
        (46.004, 6.002),
        (46.005, 6.003),
    ]
    polyline = encode_polyline(coords)
    streams = [
        _stream("time", [0, 1, 2, 3, 4, 5]),
        _stream("distance", [0, 5, 10, 15, 20, 25]),
        _stream("velocity_smooth", [0, 5, 5, 5, 5, 5]),
        _stream("altitude", [400, 405, 410, 415, 420, 425]),
        _stream("heartrate", [100, 110, 120, 130, 140, 150]),
        _stream("watts", [100, 150, 200, 250, 300, 350]),
        _stream("cadence", [80, 85, 90, 95, 100, 105]),
        _stream("latlng", coords),
    ]
    return streams, polyline


def test_builds_aligned_replay() -> None:
    streams, polyline = _base_streams()
    payload = build_replay(_activity(streams, polyline))

    ride = payload["ride"]
    assert len(ride["streams"]["t"]) == 6
    assert ride["streams"]["t"][0] == 0
    assert ride["streams"]["d"][-1] == 25
    assert ride["bounds"] == {
        "min_lat": 46.0,
        "max_lat": 46.005,
        "min_lng": 6.0,
        "max_lng": 6.003,
    }
    assert ride["key_points"]["end"] == 5
    assert ride["highlights"]["highest"]["idx"] == 5
    assert ride["stats"]["distance_m"] == 25.0
    assert ride["stats"]["avg_power_w"] == 225.0
    assert payload["activity"]["timezone"] == "UTC"
    assert payload["route"] is None

    validated = ReplayResponse.model_validate(payload)
    assert validated.ride.streams.t[0] == 0
    assert validated.ride.highlights.fastestKm is not None


def test_rejects_activity_without_speed_stream() -> None:
    with pytest.raises(ReplayUnavailable):
        build_replay(_activity([_stream("time", [0, 1, 2])], ""))


def test_decimates_large_rides() -> None:
    n = 6000
    coords = [(46.0, 6.0), (46.01, 6.01)]
    polyline = encode_polyline(coords)
    streams = [
        _stream("time", list(range(n))),
        _stream("distance", [i * 5.0 for i in range(n)]),
        _stream("velocity_smooth", [5.0] * n),
        _stream("altitude", [400.0] * n),
    ]
    payload = build_replay(_activity(streams, polyline))
    assert len(payload["ride"]["streams"]["t"]) <= 5000


def test_arthur_route_gets_pose_labels() -> None:
    streams, polyline = _base_streams()
    activity = _activity(streams, polyline)
    route = SimpleNamespace(id=uuid.uuid4(), name="Arthur's Seat Loop")
    activity.route = route
    activity.route_id = route.id
    payload = build_replay(activity)
    assert payload["ride"]["pose_labels"] == {
        "lausanne": "Start",
        "montreux": "Mid",
    }
    assert payload["route"]["name"] == "Arthur's Seat Loop"
