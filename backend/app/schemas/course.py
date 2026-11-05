"""Schemas for Course → Route → Ride."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CourseRouteRead(BaseModel):
    """One route variant inside a course."""

    id: uuid.UUID
    name: str
    sport_type: str
    distance_meters: float
    elevation_gain_meters: float | None = None
    is_loop: bool
    preview_polyline: str | None = None
    ride_count: int = 0
    confirmed_ride_count: int = 0
    suggested_ride_count: int = 0
    is_canonical: bool = False
    created_at: datetime


class CourseActivityRead(BaseModel):
    """A ride shown on a course, with its link trust state."""

    id: uuid.UUID
    name: str
    start_date: datetime
    distance_meters: float | None = None
    route_id: uuid.UUID | None = None
    route_name: str | None = None
    route_link_status: str | None = None


class CourseSummary(BaseModel):
    id: uuid.UUID
    name: str
    sport_type: str
    route_count: int
    confirmed_ride_count: int = 0
    suggested_ride_count: int = 0
    canonical_route_id: uuid.UUID | None = None
    canonical_name: str | None = None
    preview_polyline: str | None = None
    identity_source: str
    identity_confidence: float | None = None
    last_ridden_date: datetime | None = None
    created_at: datetime
    updated_at: datetime


class CourseDetail(CourseSummary):
    routes: list[CourseRouteRead] = []
    activities: list[CourseActivityRead] = []


class CourseSuggestion(BaseModel):
    """A review-tier pair from the cached similarity graph.

    ``*_course_id`` is null when a route is uncoursed; the UI can still show
    the pair, but cannot merge courses until both sides have a course.
    """

    route_a_id: uuid.UUID
    route_a_name: str
    route_a_course_id: uuid.UUID | None = None
    route_a_distance_meters: float
    route_a_preview_polyline: str | None = None
    route_b_id: uuid.UUID
    route_b_name: str
    route_b_course_id: uuid.UUID | None = None
    route_b_distance_meters: float
    route_b_preview_polyline: str | None = None
    score: float
    tier: str
    breakdown: dict | None = None


class DismissedSuggestion(BaseModel):
    """A pair the user marked "not the same course", for review/restore."""

    route_a_id: uuid.UUID
    route_a_name: str
    route_a_distance_meters: float
    route_a_preview_polyline: str | None = None
    route_b_id: uuid.UUID
    route_b_name: str
    route_b_distance_meters: float
    route_b_preview_polyline: str | None = None
    dismissed_at: datetime


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=500)
    sport_type: str | None = None


class CourseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    sport_type: str = "cycling"
    route_ids: list[uuid.UUID] = []


class RideLinkResult(BaseModel):
    activity_id: uuid.UUID
    route_id: uuid.UUID
    status: str
