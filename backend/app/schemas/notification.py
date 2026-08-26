"""Schemas for in-app notifications and preferences."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: str
    title: str
    body: str
    severity: str
    link: str
    read: bool
    created_at: datetime | None = None
    payload: dict | None = None


class NotificationPreferences(BaseModel):
    health_alert: bool
    pr: bool
    goal_milestone: bool
    plan_reminder: bool


class NotificationPreferencesUpdate(BaseModel):
    health_alert: bool | None = None
    pr: bool | None = None
    goal_milestone: bool | None = None
    plan_reminder: bool | None = None