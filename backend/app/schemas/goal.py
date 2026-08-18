import uuid
from datetime import datetime, date

from pydantic import BaseModel


class GoalBase(BaseModel):
    goal_type: str  # ftp_target, weight_target, weekly_sessions, 1rm_target, distance_target
    target_value: float
    current_value: float | None = None
    target_date: date | None = None
    notes: str | None = None


class GoalCreate(GoalBase):
    pass


class GoalUpdate(BaseModel):
    goal_type: str | None = None
    target_value: float | None = None
    current_value: float | None = None
    target_date: date | None = None
    status: str | None = None
    notes: str | None = None


class GoalRead(GoalBase):
    id: uuid.UUID
    user_id: uuid.UUID
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
