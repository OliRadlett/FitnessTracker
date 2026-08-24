"""Conformity response schemas (Phase 5C)."""

import uuid
from datetime import date

from pydantic import BaseModel


class ConformityComponent(BaseModel):
    metric: str
    planned: float | None = None
    actual: float | None = None
    deviation_pct: float | None = None
    weight_used: float | None = None  # renormalised over scored components
    component_score: float | None = None  # 0..1, None when not comparable


class ConformityResult(BaseModel):
    conformity_pct: float | None = None
    classification: str | None = None
    components: list[ConformityComponent] = []
    status: str  # done | partial | missed | extra | pending | rest
    deviations: list[str] = []


class WeeklyConformity(BaseModel):
    week_number: int
    week_start: date
    week_end: date
    days_scored: int
    days_total: int
    pct: float | None = None
    by_sport: dict[str, float | None]


class PlanConformityResponse(BaseModel):
    plan_id: uuid.UUID
    overall_pct: float | None = None
    trend: str | None = None  # improving | declining | stable
    weeks: list[WeeklyConformity]
    patterns: list[str]


class DayConformityResponse(ConformityResult):
    plan_id: uuid.UUID
    day_id: uuid.UUID
    day_date: date
    sport: str
    planned_type: str | None = None


class LinkActivitiesResponse(BaseModel):
    linked: int
