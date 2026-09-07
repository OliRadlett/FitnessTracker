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
    connection_reauth: bool
    ftp_stale: bool
    event_result: bool
    race_day: bool


class NotificationPreferencesUpdate(BaseModel):
    health_alert: bool | None = None
    pr: bool | None = None
    goal_milestone: bool | None = None
    plan_reminder: bool | None = None
    connection_reauth: bool | None = None
    ftp_stale: bool | None = None
    event_result: bool | None = None
    race_day: bool | None = None
