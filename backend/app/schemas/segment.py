"""Ride segment schemas (§3.13)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


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
    # Intelligence fields (fitted by Modal weekly task)
    cluster_id: int | None = None
    # Cross-route hill identity. `geo_cluster_size` is the number of segments
    # sharing this label across routes, computed at read time: >1 means this row
    # is one detection of a hill that appears elsewhere, and the hill row is the
    # place to show the rider's real best.
    geo_cluster_id: uuid.UUID | None = None
    geo_cluster_size: int = 1
    climb_type: str | None = None
    sustainedness: float | None = None
    difficulty_score: float | None = None
    predicted_vam: float | None = None
    predicted_time_seconds: float | None = None
    predicted_power_watts: float | None = None
    prediction_confidence: float | None = None
    intelligence_analyzed_at: datetime | None = None


class SegmentEffortRead(BaseModel):
    """One rider's pass through a segment on a given activity."""

    id: uuid.UUID
    segment_id: uuid.UUID
    activity_id: uuid.UUID
    activity_name: str | None = None
    started_at: datetime | None = None
    elapsed_seconds: float
    moving_seconds: float | None = None
    avg_power_watts: float | None = None
    avg_hr: float | None = None
    avg_speed_mps: float
    effort_vam: float | None = None
    # true = assisted, false = human, None = not yet classified. Ranking only
    # uses false; the other values are returned so the UI can label them.
    assisted: bool | None = None
    is_pr: bool = False
    # The line (route detection) this effort was measured on.
    line_id: uuid.UUID | None = None
    line_km: list[float] | None = None


class SegmentDetail(BaseModel):
    """Segment + its leaderboard-of-self efforts (PR first)."""

    segment: SegmentRead
    efforts: list[SegmentEffortRead] = []


class ClimbDetail(BaseModel):
    """One physical hill, merged across every route it appears on.

    ``name`` is canonical: the most-ridden member's name, which is the best
    available proxy for "what the rider calls this hill". Renaming is an
    explicit follow-on (§6 of the spec) -- a hill has no durable identity of its
    own, so there is nothing stable to hang a user-chosen name on yet.

    ``efforts`` is ranked by VAM, not elapsed seconds. Different routes detect
    the same hill with slightly different windows (900 m vs 950 m depending on
    elevation sampling), so elapsed seconds across members are not comparable and
    ranking by them would report a "best" nobody rode. VAM -- metres gained per
    hour -- is window-robust. Seconds fall back only when no member effort
    carries a VAM at all.
    """

    geo_cluster_id: uuid.UUID
    name: str
    route_count: int
    segments: list[SegmentRead] = []
    efforts: list[SegmentEffortRead] = []


class SegmentRecomputeResponse(BaseModel):
    """Result of recomputing segments for a route."""

    route_id: uuid.UUID
    recomputed: int = 0


# ── Stable segment groups (the /segments page) ───────────────────────────────


class SegmentGroupBest(BaseModel):
    """The best human-powered attempt on a group, under the comparable rule."""

    seconds: float
    moving_seconds: float | None = None
    power_watts: float | None = None
    vam: float | None = None
    date: datetime | None = None


class SegmentGroupPrediction(BaseModel):
    seconds: float
    vam: float | None = None
    power_watts: float | None = None
    confidence: float | None = None


class SegmentGroupRead(BaseModel):
    """One physical/defined segment, merged across every route line."""

    id: uuid.UUID
    kind: str
    name: str
    canonical_name: str
    display_name: str | None = None
    name_source: str = "route"
    area: str | None = None
    region: str | None = None
    country: str | None = None
    distance_m: float
    gain_m: float
    avg_gradient_pct: float
    max_gradient_pct: float
    steepest_200m_pct: float = 0.0
    sustained_share: float = 0.0
    # 49 × [distance_m, elevation_m, gradient_pct]
    profile: list[list[float]] = []
    category: str | None = None
    difficulty: float | None = None
    attempts: int = 0
    best: SegmentGroupBest | None = None
    last_ridden: datetime | None = None
    route_count: int = 1
    # Only returned for an unridden group; the UI never shows it beside a PR.
    prediction: SegmentGroupPrediction | None = None


class SegmentGroupDetail(BaseModel):
    group: SegmentGroupRead
    segments: list[SegmentRead] = []
    efforts: list[SegmentEffortRead] = []
    route_names: list[str] = []


class SegmentGroupList(BaseModel):
    items: list[SegmentGroupRead] = []
    total: int = 0
    counts: dict[str, int] = {}


class SegmentGroupUpdate(BaseModel):
    """Empty / null resets to the generated name."""

    display_name: str | None = Field(default=None, max_length=200)
