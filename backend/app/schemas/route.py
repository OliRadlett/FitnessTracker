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


# ── Route Tag ──────────────────────────────────────────────────────────────────


class RouteTagRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    color: str | None = None
    created_at: datetime


class RouteTagCreate(BaseModel):
    name: str
    color: str | None = None


class RouteTagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class RouteTaggingRead(BaseModel):
    model_config = {"from_attributes": True}

    route_id: uuid.UUID
    tag_id: uuid.UUID
    tagged_at: datetime


# ── Route Collection ───────────────────────────────────────────────────────────


class RouteCollectionRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    is_smart: bool = False
    rules: dict | None = None
    sort_order: int = 0
    created_at: datetime


class RouteCollectionCreate(BaseModel):
    name: str
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    is_smart: bool = False
    rules: dict | None = None


class RouteCollectionUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    rules: dict | None = None
    sort_order: int | None = None


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
    is_favorite: bool = False
    quality_score: float | None = None
    sources: list[RouteSourceRead] = []
    tags: list[RouteTagRead] = []
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
    is_favorite: bool = False
    quality_score: float | None = None
    sources: list[RouteSourceRead] = []
    surface_profile: dict | None = None
    tags: list[RouteTagRead] = []
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
    is_favorite: bool | None = None


# ── List params ──────────────────────────────────────────────────────────────


class RouteListParams(BaseModel):
    sport_type: str | None = None
    source: str | None = None
    is_loop: bool | None = None
    is_ridden: bool | None = None
    is_favorite: bool | None = None
    tag_ids: list[str] | None = None
    collection_id: str | None = None
    min_distance: float | None = None
    max_distance: float | None = None
    min_elevation: float | None = None
    max_elevation: float | None = None
    min_quality_score: float | None = None
    q: str | None = None
    surface_type: str | None = None
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


class MergeManyRequest(BaseModel):
    """Bulk merge: list of (primary, duplicate) pairs."""

    pairs: list[MergeRequest]


# ── Sync result ──────────────────────────────────────────────────────────────


class RouteSyncResult(BaseModel):
    provider: str
    synced_count: int
    merged_count: int
    new_count: int


# ── Route History ────────────────────────────────────────────────────────────


class RouteHistoryRide(BaseModel):
    """A single ride on a route."""

    model_config = {"from_attributes": True}

    activity_id: uuid.UUID
    date: datetime
    duration_seconds: int | None = None
    distance_meters: float | None = None
    average_power: float | None = None
    tss: float | None = None


class RouteHistoryPersonalBest(BaseModel):
    """Personal best ride on a route (shortest duration)."""

    model_config = {"from_attributes": True}

    activity_id: uuid.UUID
    date: datetime
    duration_seconds: int
    average_power: float | None = None


class RouteHistoryResponse(BaseModel):
    """Route ride history with personal best."""

    model_config = {"from_attributes": True}

    route_id: uuid.UUID
    route_name: str
    total_rides: int
    personal_best: RouteHistoryPersonalBest | None = None
    rides: list[RouteHistoryRide] = []


# ── Quality ──────────────────────────────────────────────────────────────────


class RouteQualityRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    route_id: uuid.UUID
    user_id: uuid.UUID
    completeness_score: float | None = None
    popularity_score: float | None = None
    surface_quality_score: float | None = None
    effort_match_score: float | None = None
    overall_score: float | None = None
    computed_at: datetime


# ── Effort Estimation ─────────────────────────────────────────────────────────


class EffortEstimateRequest(BaseModel):
    ftp_watts: float
    weight_kg: float
    bike_type: str = "road"  # road | gravel | mtb
    target_intensity: str = (
        "threshold"  # endurance | tempo | threshold | vo2max | anaerobic
    )


class EffortEstimateResponse(BaseModel):
    """Power-based effort estimate for a route."""

    estimated_time_seconds: int
    estimated_tss: float
    intensity_factor: float | None = None
    normalized_power: float | None = None
    estimated_kcal: float | None = None
    zone_name: str | None = None
    description: str | None = None
