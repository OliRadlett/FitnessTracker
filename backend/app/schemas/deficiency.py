"""Schemas for the weakness/deficiency analysis feature.

Contract for GET /api/v1/deficiency?weeks=8 — consumed by the frontend
weakness analysis cards.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

WeaknessCategory = Literal["lifting", "cycling"]
WeaknessType = Literal[
    "strength_standard",
    "ratio",
    "volume_balance",
    "vo2max_ftp_mismatch",
    "decoupling",
    "zone_distribution",
]
WeaknessSeverity = Literal["critical", "high", "medium", "low", "strength"]
StrengthLevel = Literal["beginner", "intermediate", "advanced", "elite"]
WeaknessUnit = Literal["kg", "ratio", "%"]


class WeaknessItem(BaseModel):
    """A single detected weakness (or strength)."""

    category: WeaknessCategory
    type: WeaknessType
    metric: str  # e.g. "bench_squat_ratio", "back_squat_standard"
    value: float | None = None
    unit: WeaknessUnit | None = None
    bodyweight: float | None = None
    level: StrengthLevel | None = None
    next_level_target: float | None = None
    severity: WeaknessSeverity
    detail: str  # human-readable sentence WITH numbers
    recommendation: str  # actionable suggestion


class DeficiencySummary(BaseModel):
    """Aggregate counts by severity. total_weaknesses excludes strengths."""

    total_weaknesses: int
    critical: int
    high: int
    medium: int
    low: int
    strengths: int


class DeficiencyResponse(BaseModel):
    """Full deficiency analysis response."""

    weaknesses: list[WeaknessItem]
    summary: DeficiencySummary
    computed_at: datetime
