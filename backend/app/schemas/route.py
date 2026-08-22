"""Route Pydantic schemas — request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

# ── Route Source ──────────────────────────────────────────────────────────────


class RouteSourceRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    provider: str
    provider_route_id: str
    provider_name: str
    synced_at: datetime


# ── Route ────────────────────────────────────────────────────────────────────


class RouteRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    sport_type: str
    distance_meters: float
    elevation_gain_meters: float | None = None
    estimated_time_seconds: int | None = None
    encoded_polyline: str
    elevation_profile: dict | None = None
    surface_profile: dict | None = None
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    country: str | None = None
    locality: str | None = None
    is_loop: bool
    sources: list[RouteSourceRead] = []
    created_at: datetime
    updated_at: datetime


class RouteSummary(BaseModel):
    """Lightweight route summary for list views (no polyline)."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    sport_type: str
    distance_meters: float
    elevation_gain_meters: float | None = None
    estimated_time_seconds: int | None = None
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    country: str | None = None
    locality: str | None = None
    is_loop: bool
    sources: list[RouteSourceRead] = []
    surface_profile: dict | None = None
    ride_count: int = 0
    is_ridden: bool = False
    last_ridden_date: datetime | None = None
    created_at: datetime
    updated_at: datetime


# ── Create / Update ──────────────────────────────────────────────────────────


class RouteCreate(BaseModel):
    """Create a route from GPX data or encoded polyline."""

    name: str
    sport_type: str = "cycling"
    gpx_data: str | None = Field(None, description="GPX XML string")
    encoded_polyline: str | None = Field(None, description="Google-encoded polyline")


class RouteUpdate(BaseModel):
    name: str | None = None
    sport_type: str | None = None


# ── List params ──────────────────────────────────────────────────────────────


class RouteListParams(BaseModel):
    sport_type: str | None = None
    source: str | None = None
    is_loop: bool | None = None
    min_distance: float | None = None
    max_distance: float | None = None
    min_elevation: float | None = None
    max_elevation: float | None = None
    q: str | None = None
    sort_by: str | None = None
    sort_order: str = "desc"
    limit: int = Field(default=50, le=200)
    offset: int = Field(default=0, ge=0)


# ── Merge ────────────────────────────────────────────────────────────────────


class MergeRequest(BaseModel):
    primary_route_id: uuid.UUID
    duplicate_route_id: uuid.UUID


class DuplicatePair(BaseModel):
    route_a: RouteRead
    route_b: RouteRead
    score: float


# ── Sync result ──────────────────────────────────────────────────────────────


class RouteSyncResult(BaseModel):
    provider: str
    synced_count: int
    merged_count: int
    new_count: int
