import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

GoalStatus = Literal["active", "achieved", "expired", "abandoned"]


class GoalCreate(BaseModel):
    metric: str
    target_value: float
    filter_json: dict | None = None
    target_date: date | None = None
    notes: str | None = Field(default=None, max_length=500)


class GoalUpdate(BaseModel):
    metric: str | None = None
    target_value: float | None = None
    filter_json: dict | None = None
    target_date: date | None = None
    status: GoalStatus | None = None  # literal-validated
    notes: str | None = Field(default=None, max_length=500)


class GoalRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    metric: str
    filter_json: dict | None = None
    starting_value: float | None = None
    target_value: float
    current_value: float | None = None
    target_date: date | None = None
    status: str
    notes: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class GoalEnriched(GoalRead):
    """Goal plus computed enrichment from the service layer."""

    direction: str | None = None  # "increase" | "decrease" | None
    alignment_pct: float | None = None
    progress_pct: float | None = None
    metric_label: str | None = None
    metric_unit: str | None = None
    # P2 divergence unification: single canonical trajectory word
    # (achieved/abandoned/expired/ahead/on_track/behind/off_track/unknown).
    # See services.goals.trajectory_verdict for the precedence.
    trajectory_verdict: str | None = None


class GoalCheckInCreate(BaseModel):
    value: float
    note: str | None = Field(default=None, max_length=500)


class GoalCheckInRead(BaseModel):
    id: uuid.UUID
    goal_id: uuid.UUID
    check_in_date: date
    value: float
    alignment_pct: float | None = None
    note: str | None = None
    source: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MetricInfo(BaseModel):
    """Registry entry exposed via GET /goals/metrics."""

    key: str
    label: str
    unit: str
    requires_filter: list[str] | None = None
    optional_filter: list[str] | None = None
    default_direction: str


class ReactivateResponse(BaseModel):
    id: uuid.UUID
    status: str
    message: str


class GoalTemplateCreate(BaseModel):
    """POSTable payload for one template — mirrors GoalCreate fields."""

    metric: str
    filter_json: dict | None = None
    target_value: float


class GoalTemplate(BaseModel):
    """One personalised starter from GET /goals/templates."""

    key: str
    kind: str  # plate_milestone | bw_ratio | big3_total
    title: str
    description: str
    metric: str
    filter_json: dict | None = None
    current_value: float | None = None
    suggested_target: float
    unit: str
    create_payload: GoalTemplateCreate


class GoalTemplatesResponse(BaseModel):
    """Personalised male-only template list with the bodyweight basis."""

    bodyweight_kg: float | None = None
    templates: list[GoalTemplate] = []
