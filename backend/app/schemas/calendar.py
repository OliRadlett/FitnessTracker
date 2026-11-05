"""Calendar view schemas — one dense read for the month/agenda surface.

The calendar is a *view*: it joins plan days, activities, lifting sessions,
daily metrics, sleep, events and goal target dates for one date range. It does
not invent targets. A strength plan day with no ``planned_tss`` stays null and
is reported through ``coverage`` rather than being estimated.
"""

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class CalendarRange(BaseModel):
    start: date
    end: date


class CalendarPlan(BaseModel):
    id: uuid.UUID
    name: str
    start_date: date
    end_date: date
    status: str


class CalendarCoverage(BaseModel):
    """How much of the plan actually carries a load target.

    ``planned_tss`` is only comparable with actual load for the sessions that
    have a target. Strength days usually do not; the UI must say so rather than
    treating a missing target as zero.
    """

    planned_sessions: int = 0
    target_sessions: int = 0
    planned_tss: float = 0.0
    strength_targets_missing: int = 0


class CalendarPlanDay(BaseModel):
    id: uuid.UUID
    date: date
    sport: str
    planned_type: str
    planned_tss: float | None = None
    planned_duration_min: int | None = None
    planned_focus: str | None = None
    planned_exercises: list[dict[str, Any]] | None = None
    planned_volume_kg: float | None = None
    planned_rpe: float | None = None
    planned_power_watts: float | None = None
    planned_zone: str | None = None
    workout_description: str | None = None
    completed: bool = False
    actual_activity_id: uuid.UUID | None = None
    actual_lifting_session_id: uuid.UUID | None = None


class CalendarActivity(BaseModel):
    id: uuid.UUID
    date: date
    start_date: datetime | None = None
    sport_type: str
    name: str
    duration_seconds: int | None = None
    distance_meters: float | None = None
    tss: float | None = None
    tss_source: str | None = None
    average_power: float | None = None
    normalized_power: float | None = None
    average_heartrate: float | None = None
    max_heartrate: float | None = None
    elevation_gain_meters: float | None = None
    calories: float | None = None
    source: str | None = None
    ride_context: dict[str, Any] | None = None


class CalendarLiftSet(BaseModel):
    exercise_name: str
    set_number: int
    weight_kg: float
    reps: int
    rpe: float | None = None
    is_warmup: bool = False
    is_amrap: bool = False


class CalendarLift(BaseModel):
    id: uuid.UUID
    date: date
    focus: str | None = None
    program_name: str | None = None
    duration_seconds: int | None = None
    total_volume_kg: float | None = None
    estimated_tss: float | None = None
    rpe_session: float | None = None
    set_count: int = 0
    session_split: str | None = None
    session_class: str | None = None
    sets: list[CalendarLiftSet] = Field(default_factory=list)


class CalendarMetric(BaseModel):
    date: date
    recovery_score: float | None = None
    hrv_ms: float | None = None
    strain: float | None = None
    sleep_duration_minutes: float | None = None
    sleep_efficiency: float | None = None
    resting_hr: float | None = None
    respiratory_rate: float | None = None


class CalendarSleep(BaseModel):
    date: date
    source: str | None = None
    total_sleep_seconds: int | None = None
    deep_sleep_seconds: int | None = None
    rem_sleep_seconds: int | None = None
    light_sleep_seconds: int | None = None
    awake_seconds: int | None = None
    sleep_efficiency: float | None = None
    sleep_start: datetime | None = None
    sleep_end: datetime | None = None


class CalendarDay(BaseModel):
    date: date
    plan: list[CalendarPlanDay] = Field(default_factory=list)
    activities: list[CalendarActivity] = Field(default_factory=list)
    lifts: list[CalendarLift] = Field(default_factory=list)
    metric: CalendarMetric | None = None
    sleep: CalendarSleep | None = None


class CalendarWeek(BaseModel):
    week_start: date
    week_end: date
    iso_week: int
    planned_sessions: int = 0
    completed_sessions: int = 0
    target_sessions: int = 0
    planned_tss: float = 0.0
    actual_tss: float = 0.0
    unplanned_actuals: int = 0


class CalendarEvent(BaseModel):
    id: uuid.UUID
    date: date
    name: str
    event_type: str
    target_tss: float | None = None


class CalendarGoal(BaseModel):
    id: uuid.UUID
    metric: str
    target_value: float
    target_date: date
    status: str


class CalendarCurrent(BaseModel):
    ctl: float | None = None
    atl: float | None = None
    tsb: float | None = None
    recovery: float | None = None
    strain: float | None = None
    sleep_hours: float | None = None


class CalendarResponse(BaseModel):
    range: CalendarRange
    today: date
    plan: CalendarPlan | None = None
    coverage: CalendarCoverage
    days: list[CalendarDay]
    weeks: list[CalendarWeek]
    events: list[CalendarEvent] = Field(default_factory=list)
    goals: list[CalendarGoal] = Field(default_factory=list)
    current: CalendarCurrent | None = None
    #: Section-level degradation, e.g. ``{"goals": "temporarily unavailable"}``.
    #: A failure here must never 500 the whole calendar, and the value never
    #: carries a raw backend exception.
    unavailable: dict[str, str] = Field(default_factory=dict)
