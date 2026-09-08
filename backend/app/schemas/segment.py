"""Ride segment schemas (§3.13)."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class SegmentRead(BaseModel):
    """Geometry-defined climb section of a route with PR summary."""

    id: uuid.UUID
    route_id: uuid.UUID
    route_name: str | None = None
    name: str
    start_dist_m: float
    end_dist_m: float
    distance_m: float
    elevation_gain_m: float
    avg_gradient_pct: float
    max_gradient_pct: float
    peak_elevation_m: float | None = None
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    climb_category: str | None = None
    pr_seconds: float | None = None
    best_avg_power_watts: float | None = None
    times_ridden: int = 0
    has_pr: bool = False
    effort_count: int = 0


class SegmentEffortRead(BaseModel):
    """One rider's pass through a segment on a given activity."""

    id: uuid.UUID
    segment_id: uuid.UUID
    activity_id: uuid.UUID
    activity_name: str | None = None
    started_at: datetime | None = None
    elapsed_seconds: float
    avg_power_watts: float | None = None
    avg_hr: float | None = None
    avg_speed_mps: float
    effort_vam: float | None = None
    is_pr: bool = False


class SegmentDetail(BaseModel):
    """Segment + its leaderboard-of-self efforts (PR first)."""

    segment: SegmentRead
    efforts: list[SegmentEffortRead] = []


class SegmentRecomputeResponse(BaseModel):
    """Result of recomputing segments for a route."""

    route_id: uuid.UUID
    recomputed: int = 0
