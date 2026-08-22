import uuid
from datetime import date, datetime

from pydantic import BaseModel


class TrainingPlanDayBase(BaseModel):
    day_date: date
    planned_tss: float | None = None
    planned_duration_min: int | None = None
    planned_type: str = "rest"  # rest, easy, moderate, hard, race
    notes: str | None = None


class TrainingPlanDayCreate(TrainingPlanDayBase):
    pass


class TrainingPlanDayRead(TrainingPlanDayBase):
    id: uuid.UUID
    plan_id: uuid.UUID
    activity_id: uuid.UUID | None = None
    completed: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class TrainingPlanBase(BaseModel):
    name: str
    description: str | None = None
    start_date: date
    end_date: date
    plan_type: str = "custom"  # custom, build, base, peak, taper, recovery
    status: str = "draft"  # draft, active, completed, archived


class TrainingPlanCreate(TrainingPlanBase):
    days: list[TrainingPlanDayCreate] = []


class TrainingPlanUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    plan_type: str | None = None
    status: str | None = None
    days: list[TrainingPlanDayCreate] | None = None


class TrainingPlanRead(TrainingPlanBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    days: list[TrainingPlanDayRead] = []

    model_config = {"from_attributes": True}


class TrainingPlanSummary(BaseModel):
    """Lightweight plan info without days."""

    id: uuid.UUID
    name: str
    start_date: date
    end_date: date
    plan_type: str
    status: str
    day_count: int = 0
    completed_days: int = 0

    model_config = {"from_attributes": True}


class GeneratePlanRequest(BaseModel):
    """Request to auto-generate a plan from a template."""

    name: str
    template_type: str  # build, base, peak, taper, recovery
    weeks: int = 4
    start_date: date
    base_tss: float = 300.0  # weekly TSS starting point
