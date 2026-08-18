"""Routes API — CRUD, filtering, GPX download/upload, sync, merge."""

import uuid
import logging
from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.activity import Activity
from app.models.route import Route, RouteSource
from app.models.user import User
from app.schemas.auth import UserRead  # noqa: F401
from app.schemas.route import (
    RouteRead,
    RouteSummary,
    RouteCreate,
    RouteUpdate,
    MergeRequest,
    DuplicatePair,
    RouteSyncResult,
)
from app.services.auth import get_current_user
from app.services import route_service
from app.services.gpx import route_to_gpx, parse_gpx
from app.services.polyline_utils import encode_polyline

logger = logging.getLogger(__name__)

router = APIRouter()


# Sort field mapping for routes
ROUTE_SORT_FIELDS = {
    "name": Route.name,
    "distance": Route.distance_meters,
    "elevation": Route.elevation_gain_meters,
    "created_at": Route.created_at,
    "updated_at": Route.updated_at,
}


@router.get("/", response_model=list[RouteSummary])
async def list_routes(
    sport_type: str | None = Query(None),
    source: str | None = Query(None),
    is_loop: bool | None = Query(None),
    is_ridden: bool | None = Query(None, description="Filter by ridden status: true=ridden, false=unridden"),
    min_distance: float | None = Query(None, ge=0),
    max_distance: float | None = Query(None, ge=0),
    min_elevation: float | None = Query(None, ge=0),
    max_elevation: float | None = Query(None, ge=0),
    q: str | None = Query(None),
    sort_by: str | None = Query(None, description="name, distance, elevation, ride_count, last_ridden, created_at"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List user's routes with optional filters, sort, and ride stats.

    Returns the route list with an X-Total-Count response header.
    Note: is_ridden filter is applied post-query (computed field), so
    total_count reflects SQL-level filters only.
    """
    # Build base query
    base_filters = [Route.user_id == current_user.id]
    if sport_type:
        base_filters.append(Route.sport_type == sport_type)
    if is_loop is not None:
        base_filters.append(Route.is_loop == is_loop)
    if min_distance is not None:
        base_filters.append(Route.distance_meters >= min_distance)
    if max_distance is not None:
        base_filters.append(Route.distance_meters <= max_distance)
    if min_elevation is not None:
        base_filters.append(Route.elevation_gain_meters >= min_elevation)
    if max_elevation is not None:
        base_filters.append(Route.elevation_gain_meters <= max_elevation)
    if q:
        base_filters.append(Route.name.ilike(f"%{q}%"))

    # Get total count (before pagination)
    count_query = select(func.count(Route.id)).where(*base_filters)
    if source:
        count_query = count_query.join(Route.sources).where(RouteSource.provider == source)
    count_result = await db.execute(count_query)
    total_count = int(count_result.scalar() or 0)

    query = (
        select(Route)
        .options(selectinload(Route.sources))
        .where(*base_filters)
    )

    if source:
        query = query.join(Route.sources).where(RouteSource.provider == source)

    # Apply sorting
    if sort_by and sort_by in ROUTE_SORT_FIELDS:
        sort_col = ROUTE_SORT_FIELDS[sort_by]
        query = query.order_by(desc(sort_col) if sort_order == "desc" else asc(sort_col))
    else:
        query = query.order_by(Route.created_at.desc())

    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    routes = list(result.scalars().unique().all())

    # Compute ride counts and last ridden dates for each route
    route_ids = [r.id for r in routes]
    if route_ids:
        ride_stats = await db.execute(
            select(
                Activity.route_id,
                func.count(Activity.id).label("ride_count"),
                func.max(Activity.start_date).label("last_ridden"),
            )
            .where(
                Activity.route_id.in_(route_ids),
                Activity.user_id == current_user.id,
            )
            .group_by(Activity.route_id)
        )
        stats_map: dict[uuid.UUID, tuple[int, datetime | None]] = {
            row.route_id: (row.ride_count, row.last_ridden)
            for row in ride_stats.all()
        }
    else:
        stats_map = {}

    # Build response
    summaries = []
    for r in routes:
        summary = RouteSummary.model_validate(r)
        ride_count, last_ridden = stats_map.get(r.id, (0, None))
        summary.ride_count = ride_count
        summary.is_ridden = ride_count > 0
        summary.last_ridden_date = last_ridden
        summaries.append(summary)

    # Apply is_ridden filter (post-query since it's a computed field)
    if is_ridden is not None:
        summaries = [s for s in summaries if s.is_ridden == is_ridden]

    # Sort by ride_count or last_ridden if requested (these are computed fields)
    if sort_by == "ride_count":
        summaries.sort(key=lambda s: s.ride_count, reverse=(sort_order == "desc"))
    elif sort_by == "last_ridden":
        summaries.sort(
            key=lambda s: s.last_ridden_date or datetime.min,
            reverse=(sort_order == "desc"),
        )

    from fastapi.responses import JSONResponse
    return JSONResponse(
        content=[s.model_dump(mode="json") for s in summaries],
        headers={"X-Total-Count": str(total_count)},
    )


@router.get("/duplicates", response_model=list[DuplicatePair])
async def list_duplicates(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Find potential duplicate routes for manual review."""
    pairs = await route_service.find_potential_duplicates(db, current_user.id)
    return [
        DuplicatePair(
            route_a=RouteRead.model_validate(p["route_a"]),
            route_b=RouteRead.model_validate(p["route_b"]),
            score=p["score"],
        )
        for p in pairs
    ]


@router.get("/{route_id}", response_model=RouteRead)
async def get_route(
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get route detail with all sources."""
    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    return RouteRead.model_validate(route)


@router.post("/", response_model=RouteRead)
async def create_route(
    body: RouteCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a route from GPX data or encoded polyline."""
    if body.gpx_data:
        parsed = parse_gpx(body.gpx_data)
        encoded = encode_polyline(parsed["points"])
        elevations = parsed["elevations"]
        name = body.name or parsed["name"]
        sport_type = body.sport_type or parsed["sport_type"]
        elevation_profile = {"elevations": elevations} if any(e is not None for e in elevations) else None
    elif body.encoded_polyline:
        encoded = body.encoded_polyline
        name = body.name
        sport_type = body.sport_type
        elevation_profile = None
    else:
        raise HTTPException(status_code=400, detail="Either gpx_data or encoded_polyline is required")

    # Compute distance from polyline
    from app.services.polyline_utils import polyline_total_distance
    distance = polyline_total_distance(encoded)

    route = await route_service.create_or_merge_route(
        db, current_user.id,
        name=name,
        sport_type=sport_type,
        distance_meters=distance,
        encoded_polyline=encoded,
        provider="manual",
        provider_route_id=f"manual_{uuid.uuid4().hex[:12]}",
        provider_name=name,
        elevation_profile=elevation_profile,
    )
    await db.commit()
    return RouteRead.model_validate(route)


@router.patch("/{route_id}", response_model=RouteRead)
async def update_route(
    route_id: uuid.UUID,
    body: RouteUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update route metadata (name, sport type)."""
    route = await route_service.update_route(
        db, route_id, current_user.id,
        name=body.name,
        sport_type=body.sport_type,
    )
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    await db.commit()
    return RouteRead.model_validate(route)


@router.delete("/{route_id}")
async def delete_route(
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a route and all its sources."""
    deleted = await route_service.delete_route(db, route_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Route not found")
    await db.commit()
    return {"detail": "Route deleted"}


@router.get("/{route_id}/gpx")
async def download_gpx(
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download route as GPX file."""
    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    gpx_content = route_to_gpx(route)
    filename = f"{route.name.replace(' ', '_').replace('/', '_')}.gpx"

    return StreamingResponse(
        BytesIO(gpx_content.encode("utf-8")),
        media_type="application/gpx+xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/upload-gpx", response_model=RouteRead)
async def upload_gpx(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a GPX file to create a new route."""
    if not file.filename or not file.filename.lower().endswith(".gpx"):
        raise HTTPException(status_code=400, detail="File must be a .gpx file")

    content = await file.read()
    try:
        gpx_text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be valid UTF-8 text")

    parsed = parse_gpx(gpx_text)
    encoded = encode_polyline(parsed["points"])
    elevations = parsed["elevations"]
    elevation_profile = {"elevations": elevations} if any(e is not None for e in elevations) else None

    from app.services.polyline_utils import polyline_total_distance
    distance = polyline_total_distance(encoded)

    route = await route_service.create_or_merge_route(
        db, current_user.id,
        name=parsed["name"],
        sport_type=parsed["sport_type"],
        distance_meters=distance,
        encoded_polyline=encoded,
        provider="manual",
        provider_route_id=f"gpx_{uuid.uuid4().hex[:12]}",
        provider_name=parsed["name"],
        elevation_profile=elevation_profile,
    )
    await db.commit()
    return RouteRead.model_validate(route)


@router.post("/merge", response_model=RouteRead)
async def merge_routes(
    body: MergeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually merge two routes."""
    if body.primary_route_id == body.duplicate_route_id:
        raise HTTPException(status_code=400, detail="Cannot merge a route with itself")

    merged = await route_service.merge_routes(
        db, body.primary_route_id, body.duplicate_route_id, current_user.id,
    )
    if not merged:
        raise HTTPException(status_code=404, detail="One or both routes not found")
    await db.commit()
    return RouteRead.model_validate(merged)


@router.post("/sync", response_model=list[RouteSyncResult])
async def sync_routes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger route sync from all connected providers."""
    from sqlalchemy import select
    from app.models.user import OAuthConnection

    result = await db.execute(
        select(OAuthConnection).where(OAuthConnection.user_id == current_user.id)
    )
    connections = {c.provider: c for c in result.scalars().all()}

    sync_results: list[RouteSyncResult] = []

    # Sync Strava routes
    if "strava" in connections:
        try:
            from app.services.strava import sync_strava_routes
            count, merged = await sync_strava_routes(db, current_user.id)
            sync_results.append(RouteSyncResult(
                provider="strava", synced_count=count, merged_count=merged, new_count=count - merged,
            ))
        except Exception as e:
            logger.error(f"Strava route sync failed for user {current_user.id}: {e}", exc_info=True)
            sync_results.append(RouteSyncResult(
                provider="strava", synced_count=0, merged_count=0, new_count=0,
            ))

    # Sync Komoot routes (Basic Auth — configured via komoot_email/komoot_password in settings)
    from app.config import get_settings
    _settings = get_settings()
    if _settings.komoot_email and _settings.komoot_password:
        try:
            from app.services.komoot import sync_komoot_routes
            count, merged = await sync_komoot_routes(db, current_user.id)
            sync_results.append(RouteSyncResult(
                provider="komoot", synced_count=count, merged_count=merged, new_count=count - merged,
            ))
        except Exception as e:
            logger.error(f"Komoot route sync failed for user {current_user.id}: {e}", exc_info=True)
            sync_results.append(RouteSyncResult(
                provider="komoot", synced_count=0, merged_count=0, new_count=0,
            ))

    # Sync Wahoo routes
    if "wahoo" in connections:
        try:
            from app.services.wahoo import sync_wahoo_routes
            count, merged = await sync_wahoo_routes(db, current_user.id)
            sync_results.append(RouteSyncResult(
                provider="wahoo", synced_count=count, merged_count=merged, new_count=count - merged,
            ))
        except Exception as e:
            logger.error(f"Wahoo route sync failed for user {current_user.id}: {e}", exc_info=True)
            sync_results.append(RouteSyncResult(
                provider="wahoo", synced_count=0, merged_count=0, new_count=0,
            ))

    await db.commit()
    return sync_results
