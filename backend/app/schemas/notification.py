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


class NotificationSummary(BaseModel):
    """Whole-history counts backing the notification filter chips / badge."""

    total: int
    unread: int
    by_type: dict[str, int] = {}


class NotificationPreferences(BaseModel):
    health_alert: bool
    pr: bool
    goal_milestone: bool
    plan_reminder: bool
    connection_reauth: bool
    ftp_stale: bool
    event_result: bool
    race_day: bool
    # NOTE: this DTO covers a subset of DEFAULT_PREFERENCES — video_processed,
    # plan_review, weekly_summary, streak_milestone and deload_started already
    # predate it. Adding a new type here is the documented fourth sync point
    # (plans/future-enhancements.md:212); the wider drift is pre-existing.
    wahoo_zones: bool


class NotificationPreferencesUpdate(BaseModel):
    health_alert: bool | None = None
    pr: bool | None = None
    goal_milestone: bool | None = None
    plan_reminder: bool | None = None
    connection_reauth: bool | None = None
    ftp_stale: bool | None = None
    event_result: bool | None = None
    race_day: bool | None = None
    wahoo_zones: bool | None = None
