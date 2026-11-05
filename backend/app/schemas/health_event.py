"""Schemas for user-marked illness / injury / fatigue periods."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

HealthEventType = Literal["illness", "injury", "fatigue", "other"]
HealthEventSeverity = Literal["mild", "moderate", "severe"]


class HealthEventBase(BaseModel):
    event_type: HealthEventType
    start_date: date
    end_date: date | None = None
    severity: HealthEventSeverity = "moderate"
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _end_after_start(self):
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class HealthEventCreate(HealthEventBase):
    pass


class HealthEventUpdate(BaseModel):
    event_type: HealthEventType | None = None
    start_date: date | None = None
    end_date: date | None = None
    severity: HealthEventSeverity | None = None
    note: str | None = Field(default=None, max_length=2000)


class HealthEventRead(HealthEventBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class HealthEventValidation(BaseModel):
    window_days: int
    events: int
    alerts: int
    matched_alerts: int
    alert_precision: float | None
    covered_events: int
    event_coverage: float | None
