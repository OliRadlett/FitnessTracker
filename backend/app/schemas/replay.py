"""Replay payload schemas for the 3D viewer.

The response is intentionally close to the standalone prototype's `Ride`
object. Stream arrays are aligned one-to-one; `key_points` and `highlights`
are indexes into those arrays.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class ReplayStreams(BaseModel):
    t: list[float]
    d: list[float]
    lat: list[float]
    lng: list[float]
    alt: list[float]
    v: list[float]
    hr: list[int]
    grade: list[float]
    watts: list[int] | None = None
    cadence: list[int] | None = None


class ReplayStats(BaseModel):
    distance_m: float
    moving_s: int
    elapsed_s: float
    elevation_gain_m: float
    ascent_m: float
    descent_m: float
    avg_speed_mps: float
    avg_hr: float
    avg_power_w: float | None = None
    calories: float
    pause_count: int
    pause_s: float


class ReplayWeather(BaseModel):
    temperature_c: float | None = None
    conditions: str | None = None
    wind_speed_kmh: float | None = None
    wind_direction_deg: float | None = None
    precipitation_mm: float | None = None


class ReplayBounds(BaseModel):
    min_lat: float
    max_lat: float
    min_lng: float
    max_lng: float


class ReplayHighlight(BaseModel):
    startIdx: int | None = None
    endIdx: int | None = None
    idx: int | None = None
    startD: float | None = None
    endD: float | None = None
    gainM: float | None = None
    dropM: float | None = None
    gradePct: float | None = None
    speedKmh: float | None = None
    altM: float | None = None
    place: str | None = None


class ReplayHighlights(BaseModel):
    climb: ReplayHighlight
    descent: ReplayHighlight
    fastestKm: ReplayHighlight
    highest: ReplayHighlight
    lowest: ReplayHighlight


class ReplayRide(BaseModel):
    id: str
    activity_id: str
    name: str
    date: datetime
    timezone: str
    pose_labels: dict[str, str] | None = None
    stats: ReplayStats
    weather: ReplayWeather
    bounds: ReplayBounds
    streams: ReplayStreams
    key_points: dict[str, int]
    highlights: ReplayHighlights
    encoded_polyline: str | None = None


class ReplayActivity(BaseModel):
    id: uuid.UUID
    name: str
    start_date: datetime
    timezone: str
    sport_type: str
    source: str
    route_id: uuid.UUID | None = None


class ReplayRoute(BaseModel):
    id: uuid.UUID
    name: str


class ReplayResponse(BaseModel):
    activity: ReplayActivity
    ride: ReplayRide
    route: ReplayRoute | None = None
    map_allowed: bool = True
    map_used: int = 0
    map_limit: int = 500


class GhostCandidate(BaseModel):
    """A past ride on the same route, offered as a ghost to race against."""

    activity_id: uuid.UUID
    name: str
    start_date: datetime
    timezone: str
    distance_m: float
    moving_s: int
    avg_speed_mps: float | None = None


class GhostListResponse(BaseModel):
    """Ghost options for one activity.

    `reason` explains an empty list, so the viewer can say *why* there is no
    history instead of showing a picker that silently never appears.
    `pb_activity_id` is the fastest ride on the route — the one to beat.
    """

    route_id: uuid.UUID | None = None
    route_name: str | None = None
    candidates: list[GhostCandidate] = []
    reason: str | None = None
    pb_activity_id: uuid.UUID | None = None

