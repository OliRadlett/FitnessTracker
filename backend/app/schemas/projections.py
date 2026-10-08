"""Schemas for projections & success prediction (Phase 7).

Contract for:
  GET /api/v1/projections/goal/{goal_id}
  GET /api/v1/projections/metric/{metric_key}
  GET /api/v1/projections/tsb/{plan_id}
"""

from __future__ import annotations

import uuid
from datetime import date

from pydantic import BaseModel


class TrendInfo(BaseModel):
    """Regression trend metadata."""

    slope_per_day: float
    slope_per_week: float
    r_squared: float
    data_points: int
    # Quality-gate flags (P0): False/"low_r_squared"|"implausible_rate" when
    # the fitted slope failed the R² or rate-of-gain gates — the projection
    # is then suppressed and the badge reads "Not enough data". Default True
    # / None preserves the shape for ungated trends and older clients.
    plausible: bool = True
    gated_reason: str | None = None
    # P2 deload-aware progress: check-ins excluded from the fit because they
    # fell in deload weeks (0 when the metric-trend path, which does not
    # filter, or when no deload weeks were detected).
    deload_weeks_skipped: int = 0


class ProjectionPoint(BaseModel):
    """A single date+value pair for projection lines."""

    date: date
    value: float


class GoalProjectionResponse(BaseModel):
    """Full projection for a single goal."""

    goal_id: uuid.UUID
    metric: str
    current_value: float | None
    target_value: float
    target_date: date | None
    direction: str | None  # increase / decrease
    trend: TrendInfo | None
    projection: dict | None  # {projected_date, days_remaining}
    badge: str  # On Track / At Risk / Unlikely / Not enough data
    history: list[ProjectionPoint]
    projection_line: list[ProjectionPoint]


class MetricTrendResponse(BaseModel):
    """Trend for any metric in the registry."""

    metric: str
    current_value: float | None
    trend: TrendInfo | None
    classification: str | None
    history: list[ProjectionPoint] = []  # fitted points (B-14 chart overlays)
    projection_line: list[ProjectionPoint] = []  # 8 weekly steps ahead


class TsbProjectionPoint(BaseModel):
    """A single day in the TSB projection."""

    date: date
    ctl: float
    atl: float
    tsb: float
    # F9: adherence-sensitivity bands (±20% planned-TSS scenarios by
    # default). Optional so older payloads still validate.
    tsb_low: float | None = None
    tsb_high: float | None = None


class TsbProjectionResponse(BaseModel):
    """TSB projection for an event-linked training plan."""

    plan_id: uuid.UUID
    event_date: date | None
    current_tsb: float | None
    race_day_tsb: float | None
    freshness_assessment: str | None
    projection: list[TsbProjectionPoint]
