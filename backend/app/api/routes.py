"""Routes API — CRUD, filtering, GPX download/upload, sync, merge.

Extended with:
  - Tags (user-defined, flat multi-assign)
  - Collections (manual groups + smart/rule-based)
  - Route quality scores
  - Effort estimation (power-based)
  - Bulk operations (GPX export, merge, delete)
"""

import json
import logging
import math
import uuid
from datetime import datetime
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import asc, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.activity import Activity
from app.models.route import Route, RouteSource
from app.models.route_organize import (
    RouteCollection,
    RouteCollectionItem,
    RouteQuality,
    RouteTag,
    RouteTagging,
)
from app.models.user import User
from app.schemas.auth import UserRead
from app.schemas.route import (
    DuplicatePair,
    EffortEstimateRequest,
    EffortEstimateResponse,
    HomeAreaHeatmapResponse,
    HomeAreaActivityPoint,
    MergeManyRequest,
    MergeRequest,
    MergedRouteView,
    RiddenSegment,
    RouteCollectionCreate,
    RouteCollectionRead,
    RouteCollectionUpdate,
    RouteCreate,
    RouteHistoryPersonalBest,
    RouteHistoryResponse,
    RouteHistoryRide,
    RouteQualityRead,
    RouteRead,
    RouteSummary,
    RouteSyncResult,
    RouteTagCreate,
    RouteTagRead,
    RouteTagUpdate,
    RouteUpdate,
)
from app.services import route_service
from app.services.auth import get_current_user
from app.services.effort_estimator import INTENSITY_ZONES, estimate_effort
from app.services.gpx import parse_gpx, route_to_gpx
from app.services.polyline_utils import encode_polyline, polyline_total_distance

# Reuse the polyline extraction helper from the activities API
from app.api.activities import _extract_encoded_polyline

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Routes List (enhanced with tags, collections, quality) ─────────────────────


@router.get("/", response_model=list[RouteSummary])
async def list_routes(
    sport_type: str | None = Query(None),
    source: str | None = Query(None),
    is_loop: bool | None = Query(None),
    is_ridden: bool | None = Query(
        None, description="Filter by ridden status: true=ridden, false=unridden"
    ),
    is_favorite: bool | None = Query(None),
    tag_ids: list[str] = Query(None, alias="tag_ids"),
    collection_id: str | None = Query(None),
    min_distance: float | None = Query(None, ge=0),
    max_distance: float | None = Query(None, ge=0),
    min_elevation: float | None = Query(None, ge=0),
    max_elevation: float | None = Query(None, ge=0),
    min_quality_score: float | None = Query(None, ge=0, le=100),
    q: str | None = Query(None),
    surface_type: str | None = Query(
        None,
        description="Filter by surface type key in surface_profile JSONB",
    ),
    sort_by: str | None = Query(
        None,
        description="name, distance, elevation, ride_count, last_ridden, created_at, quality_score",
    ),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List user's routes with optional filters, sort, and ride stats.

    Returns the route list with an X-Total-Count response header.
    Ride counts and last-ridden dates are computed via SQL subquery.
    """

    base_filters = [Route.user_id == current_user.id]
    if sport_type:
        base_filters.append(Route.sport_type == sport_type)
    if is_loop is not None:
        base_filters.append(Route.is_loop == is_loop)
    if is_favorite is not None:
        base_filters.append(Route.is_favorite == is_favorite)
    if min_distance is not None:
        base_filters.append(Route.distance_meters >= min_distance)
    if max_distance is not None:
        base_filters.append(Route.distance_meters <= max_distance)
    if min_elevation is not None:
        base_filters.append(Route.elevation_gain_meters >= min_elevation)
    if max_elevation is not None:
        base_filters.append(Route.elevation_gain_meters <= max_elevation)
    if min_quality_score is not None:
        base_filters.append(Route.quality_score >= min_quality_score)
    if q:
        base_filters.append(Route.name.ilike(f"%{q}%"))
    if surface_type:
        base_filters.append(Route.surface_profile.has_key(surface_type))

    # Subquery: ride count and last ridden date per route
    ride_stats_subq = (
        select(
            Activity.route_id.label("stat_route_id"),
            func.count(Activity.id).label("ride_count"),
            func.max(Activity.start_date).label("last_ridden"),
        )
        .where(Activity.user_id == current_user.id)
        .group_by(Activity.route_id)
        .subquery()
    )

    # Tag filtering: join through route_taggings
    tag_ids_list: list[uuid.UUID] = []
    if tag_ids:
        for tid in tag_ids:
            try:
                tag_ids_list.append(uuid.UUID(tid))
            except (ValueError, AttributeError):
                logger.warning(f"Invalid tag_id in filter: {tid}")

    tag_filter = None
    if tag_ids_list:
        tag_filter = select(RouteTagging.route_id).where(
            RouteTagging.tag_id.in_(tag_ids_list)
        )

    # Collection filtering: handle both manual and smart collections
    collection_filter = None
    smart_collection_route_ids: list[uuid.UUID] | None = None
    if collection_id:
        # Check if it's a smart collection
        try:
            coll_uuid = uuid.UUID(collection_id)
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="Invalid collection_id")

        coll_result = await db.execute(
            select(RouteCollection).where(
                RouteCollection.id == coll_uuid,
                RouteCollection.user_id == current_user.id,
            )
        )
        collection = coll_result.scalar_one_or_none()

        if collection and collection.is_smart:
            # Evaluate smart collection rules to get matching route IDs
            from app.services.route_collection_rules import evaluate_smart_collection

            smart_routes = await evaluate_smart_collection(
                db, current_user.id, coll_uuid
            )
            smart_collection_route_ids = [r.id for r in smart_routes]
        elif collection:
            collection_filter = select(RouteCollectionItem.route_id).where(
                RouteCollectionItem.collection_id == coll_uuid
            )

    # Main query with LEFT JOIN to ride stats
    query = (
        select(
            Route,
            func.coalesce(ride_stats_subq.c.ride_count, 0).label("ride_count"),
            ride_stats_subq.c.last_ridden.label("last_ridden"),
        )
        .outerjoin(ride_stats_subq, Route.id == ride_stats_subq.c.stat_route_id)
        .options(
            selectinload(Route.sources),
            selectinload(Route.tags),
        )
        .where(*base_filters)
    )

    if source:
        query = query.join(Route.sources).where(RouteSource.provider == source)

    if tag_filter is not None:
        query = query.where(Route.id.in_(select(tag_filter)))

    if collection_filter is not None:
        query = query.where(Route.id.in_(select(collection_filter)))

    # For smart collections, filter by the evaluated route IDs
    if smart_collection_route_ids:
        query = query.where(Route.id.in_(smart_collection_route_ids))

    # Apply is_ridden filter in SQL
    if is_ridden is True:
        query = query.where(ride_stats_subq.c.ride_count > 0)
    elif is_ridden is False:
        query = query.where(ride_stats_subq.c.ride_count == 0)

    # Apply sorting
    sort_column_map = {
        "name": Route.name,
        "distance": Route.distance_meters,
        "elevation": Route.elevation_gain_meters,
        "created_at": Route.created_at,
        "updated_at": Route.updated_at,
        "ride_count": ride_stats_subq.c.ride_count,
        "last_ridden": ride_stats_subq.c.last_ridden,
        "quality_score": Route.quality_score,
    }
    if sort_by and sort_by in sort_column_map:
        sort_col = sort_column_map[sort_by]
        if sort_by in ("ride_count", "last_ridden", "quality_score"):
            query = query.order_by(
                sort_col.asc().nullsfirst()
                if sort_order == "asc"
                else sort_col.desc().nullslast()
            )
        else:
            query = query.order_by(
                desc(sort_col) if sort_order == "desc" else asc(sort_col)
            )
    else:
        query = query.order_by(Route.created_at.desc())

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    count_result = await db.execute(count_query)
    total_count = int(count_result.scalar() or 0)

    # Apply pagination
    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    rows = result.all()

    # Build response with tags populated
    from fastapi.responses import JSONResponse

    summaries = []
    for row in rows:
        route = row[0]
        ride_count = int(row[1] or 0)
        last_ridden = row[2]
        summary = RouteSummary.model_validate(route)
        summary.ride_count = ride_count
        summary.is_ridden = ride_count > 0
        summary.last_ridden_date = last_ridden
        summaries.append(summary)

    return JSONResponse(
        content=[s.model_dump(mode="json") for s in summaries],
        headers={"X-Total-Count": str(total_count)},
    )


# ─── Tags ──────────────────────────────────────────────────────────────────────


@router.get("/tags", response_model=list[RouteTagRead])
async def list_tags(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all tags for the user."""
    result = await db.execute(
        select(RouteTag)
        .where(RouteTag.user_id == current_user.id)
        .order_by(RouteTag.name)
    )
    tags = list(result.scalars().all())
    return [RouteTagRead.model_validate(t) for t in tags]


@router.post("/tags", response_model=RouteTagRead)
async def create_tag(
    body: RouteTagCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new tag."""
    tag = RouteTag(user_id=current_user.id, name=body.name, color=body.color)
    db.add(tag)
    await db.commit()
    return RouteTagRead.model_validate(tag)


@router.patch("/tags/{tag_id}", response_model=RouteTagRead)
async def update_tag(
    tag_id: uuid.UUID,
    body: RouteTagUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a tag."""
    result = await db.execute(
        select(RouteTag).where(
            RouteTag.id == tag_id, RouteTag.user_id == current_user.id
        )
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    if body.name is not None:
        tag.name = body.name
    if body.color is not None:
        tag.color = body.color
    await db.commit()
    return RouteTagRead.model_validate(tag)


@router.delete("/tags/{tag_id}")
async def delete_tag(
    tag_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a tag."""
    result = await db.execute(
        select(RouteTag).where(
            RouteTag.id == tag_id, RouteTag.user_id == current_user.id
        )
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    await db.delete(tag)
    await db.commit()
    return {"detail": "Tag deleted"}


@router.post("/tags/{tag_id}/routes/{route_id}")
async def add_route_tag(
    tag_id: uuid.UUID,
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a tag to a route."""
    # Verify both tag and route belong to user
    result = await db.execute(
        select(RouteTag).where(
            RouteTag.id == tag_id, RouteTag.user_id == current_user.id
        )
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    # Check if tagging already exists
    existing = await db.execute(
        select(RouteTagging).where(
            RouteTagging.tag_id == tag_id, RouteTagging.route_id == route_id
        )
    )
    if existing.scalar_one_or_none():
        return {"detail": "Route already tagged"}

    tagging = RouteTagging(tag_id=tag_id, route_id=route_id)
    db.add(tagging)
    await db.commit()
    return {"detail": "Route tagged"}


@router.delete("/tags/{tag_id}/routes/{route_id}")
async def remove_route_tag(
    tag_id: uuid.UUID,
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a tag from a route."""
    result = await db.execute(
        select(RouteTagging).where(
            RouteTagging.tag_id == tag_id,
            RouteTagging.route_id == route_id,
        )
    )
    tagging = result.scalar_one_or_none()
    if not tagging:
        raise HTTPException(status_code=404, detail="Tagging not found")

    # Verify route belongs to user
    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    await db.delete(tagging)
    await db.commit()
    return {"detail": "Tag removed"}


# ─── Collections ───────────────────────────────────────────────────────────────


@router.get("/collections", response_model=list[RouteCollectionRead])
async def list_collections(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all collections (manual + smart) for the user."""
    result = await db.execute(
        select(RouteCollection)
        .where(RouteCollection.user_id == current_user.id)
        .order_by(RouteCollection.sort_order, RouteCollection.name)
    )
    collections = list(result.scalars().all())
    return [RouteCollectionRead.model_validate(c) for c in collections]


@router.post("/collections", response_model=RouteCollectionRead)
async def create_collection(
    body: RouteCollectionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new collection (manual or smart)."""
    collection = RouteCollection(
        user_id=current_user.id,
        name=body.name,
        description=body.description,
        icon=body.icon,
        color=body.color,
        is_smart=body.is_smart,
        rules=body.rules,
    )
    db.add(collection)
    await db.commit()
    return RouteCollectionRead.model_validate(collection)


@router.patch("/collections/{collection_id}", response_model=RouteCollectionRead)
async def update_collection(
    collection_id: uuid.UUID,
    body: RouteCollectionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a collection."""
    result = await db.execute(
        select(RouteCollection).where(
            RouteCollection.id == collection_id,
            RouteCollection.user_id == current_user.id,
        )
    )
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    if body.name is not None:
        collection.name = body.name
    if body.description is not None:
        collection.description = body.description
    if body.icon is not None:
        collection.icon = body.icon
    if body.color is not None:
        collection.color = body.color
    if body.rules is not None:
        collection.rules = body.rules
    if body.sort_order is not None:
        collection.sort_order = body.sort_order
    await db.commit()
    return RouteCollectionRead.model_validate(collection)


@router.delete("/collections/{collection_id}")
async def delete_collection(
    collection_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a collection."""
    result = await db.execute(
        select(RouteCollection).where(
            RouteCollection.id == collection_id,
            RouteCollection.user_id == current_user.id,
        )
    )
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    await db.delete(collection)
    await db.commit()
    return {"detail": "Collection deleted"}


@router.post("/collections/{collection_id}/routes/{route_id}")
async def add_to_collection(
    collection_id: uuid.UUID,
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a route to a manual collection."""
    result = await db.execute(
        select(RouteCollection).where(
            RouteCollection.id == collection_id,
            RouteCollection.user_id == current_user.id,
        )
    )
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    if collection.is_smart:
        raise HTTPException(
            status_code=400, detail="Cannot manually add to a smart collection"
        )

    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    existing = await db.execute(
        select(RouteCollectionItem).where(
            RouteCollectionItem.collection_id == collection_id,
            RouteCollectionItem.route_id == route_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"detail": "Route already in collection"}

    item = RouteCollectionItem(collection_id=collection_id, route_id=route_id)
    db.add(item)
    await db.commit()
    return {"detail": "Route added to collection"}


@router.delete("/collections/{collection_id}/routes/{route_id}")
async def remove_from_collection(
    collection_id: uuid.UUID,
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a route from a collection."""
    result = await db.execute(
        select(RouteCollectionItem).where(
            RouteCollectionItem.collection_id == collection_id,
            RouteCollectionItem.route_id == route_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Verify ownership
    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    await db.delete(item)
    await db.commit()
    return {"detail": "Route removed from collection"}


@router.post("/collections/from-filters", response_model=RouteCollectionRead)
async def create_collection_from_filters(
    body: RouteCollectionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a smart collection from current filter rules."""
    # The rules are passed in body.rules — create as a smart collection
    collection = RouteCollection(
        user_id=current_user.id,
        name=body.name,
        description=body.description,
        icon=body.icon or "folder",
        color=body.color,
        is_smart=True,
        rules=body.rules,
    )
    db.add(collection)
    await db.commit()
    return RouteCollectionRead.model_validate(collection)


# ─── Quality ───────────────────────────────────────────────────────────────────


@router.get("/quality", response_model=list[RouteQualityRead])
async def list_quality(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all quality scores for the user's routes."""
    result = await db.execute(
        select(RouteQuality)
        .where(RouteQuality.user_id == current_user.id)
        .order_by(RouteQuality.overall_score.desc().nullslast())
    )
    qualities = list(result.scalars().all())
    return [RouteQualityRead.model_validate(q) for q in qualities]


@router.post("/quality/recompute")
async def recompute_quality(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger quality recompute for all user routes (or specific route_ids)."""
    from app.services.route_quality_service import compute_and_store_quality

    result = await db.execute(select(Route).where(Route.user_id == current_user.id))
    routes = list(result.scalars().all())

    updated = 0
    for route in routes:
        try:
            await compute_and_store_quality(db, route, current_user.id)
            updated += 1
        except Exception as e:
            logger.warning(f"Quality scoring failed for route {route.id}: {e}")

    await db.commit()
    return {"updated": updated, "total": len(routes)}


# ─── Effort Estimation ─────────────────────────────────────────────────────────


@router.get("/{route_id}/effort-estimate", response_model=EffortEstimateResponse)
async def get_effort_estimate(
    route_id: uuid.UUID,
    intensity: str = Query(
        "tempo",
        description="Target intensity zone: endurance, tempo, threshold, vo2max, anaerobic",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Estimate cycling effort for a route using the user's cycling profile.

    Falls back to query params if the user has no cycling profile configured.
    Defaults to tempo (Z3) — a moderate, rideable effort.
    """
    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    # Fetch user's cycling profile for FTP and weight
    from app.models.cycling import CyclingProfile

    profile_result = await db.execute(
        select(CyclingProfile).where(CyclingProfile.user_id == current_user.id)
    )
    profile = profile_result.scalar_one_or_none()

    if profile and profile.ftp_watts and profile.weight_kg:
        result = estimate_effort(
            route,
            ftp_watts=profile.ftp_watts,
            weight_kg=profile.weight_kg,
            bike_type="road",
            target_intensity=intensity,
        )
    else:
        result = {
            "estimated_time_seconds": 0,
            "estimated_tss": 0.0,
            "intensity_factor": 0.0,
            "normalized_power": 0.0,
            "estimated_kcal": 0.0,
            "zone_name": None,
            "description": "Configure your FTP and weight in Settings → Cycling Profile to get effort estimates.",
        }
    return EffortEstimateResponse(**result)


@router.post(
    "/{route_id}/effort-estimate-custom", response_model=EffortEstimateResponse
)
async def post_effort_estimate(
    route_id: uuid.UUID,
    body: EffortEstimateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Estimate cycling effort for a route with custom parameters."""
    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    result = estimate_effort(
        route,
        ftp_watts=body.ftp_watts,
        weight_kg=body.weight_kg,
        bike_type=body.bike_type,
        target_intensity=body.target_intensity,
    )
    return EffortEstimateResponse(**result)


# ─── Route CRUD ────────────────────────────────────────────────────────────────


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
        elevation_profile = (
            {"elevations": elevations}
            if any(e is not None for e in elevations)
            else None
        )
    elif body.encoded_polyline:
        encoded = body.encoded_polyline
        name = body.name
        sport_type = body.sport_type
        elevation_profile = None
    else:
        raise HTTPException(
            status_code=400, detail="Either gpx_data or encoded_polyline is required"
        )

    distance = polyline_total_distance(encoded)

    route = await route_service.create_or_merge_route(
        db,
        current_user.id,
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
    """Update route metadata."""
    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    if body.name is not None:
        route.name = body.name
    if body.sport_type is not None:
        route.sport_type = body.sport_type
    if body.is_favorite is not None:
        route.is_favorite = body.is_favorite
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


@router.post("/merge-many", response_model=list[RouteRead])
async def merge_routes_many(
    body: MergeManyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bulk merge multiple route pairs."""
    results = []
    for pair in body.pairs:
        if pair.primary_route_id == pair.duplicate_route_id:
            continue
        merged = await route_service.merge_routes(
            db,
            pair.primary_route_id,
            pair.duplicate_route_id,
            current_user.id,
        )
        if merged:
            results.append(RouteRead.model_validate(merged))
    await db.commit()
    return results


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
        db,
        body.primary_route_id,
        body.duplicate_route_id,
        current_user.id,
    )
    if not merged:
        raise HTTPException(status_code=404, detail="One or both routes not found")
    await db.commit()
    return RouteRead.model_validate(merged)


# ─── Bulk Operations ───────────────────────────────────────────────────────────


@router.post("/bulk/export-gpx")
async def bulk_export_gpx(
    route_ids: list[str],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export multiple routes as a single ZIP of GPX files."""
    uuid_ids = [uuid.UUID(rid) for rid in route_ids]
    result = await db.execute(
        select(Route)
        .options(selectinload(Route.sources))
        .where(Route.user_id == current_user.id, Route.id.in_(uuid_ids))
    )
    routes = list(result.scalars().all())

    if not routes:
        raise HTTPException(status_code=404, detail="No routes found")

    zip_buffer = BytesIO()
    with ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for route in routes:
            gpx_content = route_to_gpx(route)
            filename = f"{route.name.replace(' ', '_').replace('/', '_')}.gpx"
            zf.writestr(filename, gpx_content)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=routes_export.zip"},
    )


@router.post("/bulk/delete")
async def bulk_delete_routes(
    route_ids: list[str],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple routes at once."""
    uuid_ids = [uuid.UUID(rid) for rid in route_ids]
    result = await db.execute(
        select(Route).where(Route.user_id == current_user.id, Route.id.in_(uuid_ids))
    )
    routes = list(result.scalars().all())
    if not routes:
        raise HTTPException(status_code=404, detail="No routes found")

    deleted_count = 0
    for route in routes:
        await db.delete(route)
        deleted_count += 1

    await db.commit()
    return {"deleted": deleted_count, "total": len(route_ids)}


# ─── Route Weather ─────────────────────────────────────────────────────────────


@router.get("/{route_id}/weather")
async def get_route_weather(
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get weather conditions and forecast for a route's start location."""
    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    from app.services.weather import cache_coords, get_current, get_forecast

    lat, lng = cache_coords(route.start_lat, route.start_lng)

    # Fetch current conditions and forecast concurrently
    try:
        current = await get_current(db, current_user.id, lat, lng)
        forecast = await get_forecast(db, current_user.id, lat, lng, days=7)
    except ValueError:
        return {
            "current": None,
            "forecast": {"days": []},
            "note": "Weather data temporarily unavailable",
        }

    return {
        "current": current,
        "forecast": forecast,
        "location": {
            "lat": lat,
            "lng": lng,
            "locality": route.locality,
            "country": route.country,
        },
    }


# ─── GPX & Sync ────────────────────────────────────────────────────────────────


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

    MAX_FILE_SIZE = 50 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413, detail="File too large. Maximum size is 50MB."
        )
    try:
        gpx_text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be valid UTF-8 text")

    parsed = parse_gpx(gpx_text)
    encoded = encode_polyline(parsed["points"])
    elevations = parsed["elevations"]
    elevation_profile = (
        {"elevations": elevations} if any(e is not None for e in elevations) else None
    )

    distance = polyline_total_distance(encoded)

    route = await route_service.create_or_merge_route(
        db,
        current_user.id,
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


@router.post("/duplicates/auto-merge")
async def auto_merge_duplicates(
    threshold: float = Query(0.90, ge=0.5, le=0.99),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Auto-merge duplicate pairs above the given threshold."""
    pairs = await route_service.find_potential_duplicates(db, current_user.id)

    merged_count = 0
    for p in pairs:
        if p["score"] >= threshold:
            merged = await route_service.merge_routes(
                db,
                p["route_a"].id,
                p["route_b"].id,
                current_user.id,
            )
            if merged:
                merged_count += 1

    await db.commit()
    return {"merged": merged_count, "threshold": threshold}


# ─── Home Area Heatmap ────────────────────────────────────────────────────────


@router.get("/heatmap/home", response_model=HomeAreaHeatmapResponse)
async def get_home_area_heatmap(
    radius_km: float = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get activity points near the user's home area for heatmap rendering.

    Resolves the user's home location (CyclingProfile.home_lat/home_lng) and
    samples lat/lng points from recent activity polylines within the radius.
    """
    from app.services.weather import resolve_user_coords
    from app.services.polyline_utils import decode_polyline, haversine_distance

    home = await resolve_user_coords(db, current_user.id)
    if not home:
        raise HTTPException(
            status_code=200,
            detail="No home location set. Configure Cycling Profile in Settings.",
            headers={"X-Has-Home": "false"},
        )

    home_lat, home_lng = home

    # Fetch activities with polylines — we'll filter by distance to home in Python
    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * max(math.cos(math.radians(home_lat)), 0.1))

    activities_result = await db.execute(
        select(Activity)
        .options(selectinload(Activity.route))
        .where(
            Activity.user_id == current_user.id,
            Activity.sport_type.in_(["cycling", "running"]),
            Activity.raw_data.isnot(None),
        )
        .order_by(Activity.start_date.desc())
        .limit(500)
    )

    activities = list(activities_result.scalars().all())

    points: list[HomeAreaActivityPoint] = []
    seen: set[tuple[float, float]] = set()

    for activity in activities:
        encoded = _extract_encoded_polyline(activity)
        if not encoded:
            continue

        # Quick bounding box filter on start point from raw_data
        start_coords = None
        if isinstance(activity.raw_data, dict):
            start_coords = activity.raw_data.get("start_latlng")
            if isinstance(start_coords, list) and len(start_coords) >= 2:
                s_lat, s_lng = float(start_coords[0]), float(start_coords[1])
                if (
                    abs(s_lat - home_lat) > lat_delta
                    or abs(s_lng - home_lng) > lng_delta
                ):
                    continue

        # Also check linked route start coordinates as a fallback
        if start_coords is None and activity.route:
            s_lat, s_lng = (
                float(activity.route.start_lat),
                float(activity.route.start_lng),
            )
            if abs(s_lat - home_lat) > lat_delta or abs(s_lng - home_lng) > lng_delta:
                continue

        try:
            decoded = decode_polyline(encoded)
        except Exception:
            continue

        # Sample points within radius, dedupe to avoid excessive density
        for lat, lng in decoded:
            dist = haversine_distance(lat, lng, home_lat, home_lng)
            if dist <= radius_km * 1000:
                # Round to ~5m precision for dedup
                key = (round(lat * 1e4) / 1e4, round(lng * 1e4) / 1e4)
                if key not in seen:
                    seen.add(key)
                    points.append(HomeAreaActivityPoint(lat=lat, lng=lng))

    return HomeAreaHeatmapResponse(
        center_lat=home_lat,
        center_lng=home_lng,
        radius_km=radius_km,
        points=points,
    )


# ─── Sync ──────────────────────────────────────────────────────────────────────


@router.post("/sync", response_model=list[RouteSyncResult])
async def sync_routes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger route sync from all connected providers."""
    from app.models.user import OAuthConnection

    result = await db.execute(
        select(OAuthConnection).where(OAuthConnection.user_id == current_user.id)
    )
    connections = {c.provider: c for c in result.scalars().all()}

    sync_results: list[RouteSyncResult] = []

    if "strava" in connections:
        try:
            from app.services.strava import sync_strava_routes

            count, merged = await sync_strava_routes(db, current_user.id)
            sync_results.append(
                RouteSyncResult(
                    provider="strava",
                    synced_count=count,
                    merged_count=merged,
                    new_count=count - merged,
                )
            )
        except Exception as e:
            logger.error(
                f"Strava route sync failed for user {current_user.id}: {e}",
                exc_info=True,
            )
            sync_results.append(
                RouteSyncResult(
                    provider="strava", synced_count=0, merged_count=0, new_count=0
                )
            )

    from app.config import get_settings

    _settings = get_settings()
    if _settings.komoot_email and _settings.komoot_password:
        try:
            from app.services.komoot import sync_komoot_routes

            count, merged = await sync_komoot_routes(db, current_user.id)
            sync_results.append(
                RouteSyncResult(
                    provider="komoot",
                    synced_count=count,
                    merged_count=merged,
                    new_count=count - merged,
                )
            )
        except Exception as e:
            logger.error(
                f"Komoot route sync failed for user {current_user.id}: {e}",
                exc_info=True,
            )
            sync_results.append(
                RouteSyncResult(
                    provider="komoot", synced_count=0, merged_count=0, new_count=0
                )
            )

    if "wahoo" in connections:
        try:
            from app.services.wahoo import sync_wahoo_routes

            count, merged = await sync_wahoo_routes(db, current_user.id)
            sync_results.append(
                RouteSyncResult(
                    provider="wahoo",
                    synced_count=count,
                    merged_count=merged,
                    new_count=count - merged,
                )
            )
        except Exception as e:
            logger.error(
                f"Wahoo route sync failed for user {current_user.id}: {e}",
                exc_info=True,
            )
            sync_results.append(
                RouteSyncResult(
                    provider="wahoo", synced_count=0, merged_count=0, new_count=0
                )
            )

    await db.commit()
    return sync_results


# ─── Dynamic Route Detail & Sub-Resources (after all static routes) ─────────────
# IMPORTANT: All /{route_id} dynamic GET routes MUST be registered after every
# static single-segment GET route (e.g. /tags, /collections, /quality,
# /duplicates).  FastAPI matches routes in registration order, so a /{route_id}
# route registered before /tags would shadow it — "tags" is not a valid UUID,
# resulting in a 422 ValidationError instead of routing to the intended handler.


@router.get("/{route_id}", response_model=RouteRead)
async def get_route(
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get route detail with all sources and tags."""
    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    return RouteRead.model_validate(route)


@router.get("/{route_id}/history", response_model=RouteHistoryResponse)
async def get_route_history(
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get ride history for a route, including personal best."""
    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    activities_result = await db.execute(
        select(Activity)
        .where(
            Activity.route_id == route_id,
            Activity.user_id == current_user.id,
        )
        .order_by(Activity.start_date.desc())
    )
    activities = list(activities_result.scalars().all())

    rides = [
        RouteHistoryRide(
            activity_id=a.id,
            date=a.start_date,
            duration_seconds=a.duration_seconds,
            distance_meters=a.distance_meters,
            average_power=a.average_power,
            tss=a.tss,
        )
        for a in activities
    ]

    # Personal best = shortest duration ride
    pb_ride = None
    if rides:
        pb = min(rides, key=lambda r: r.duration_seconds or float("inf"))
        if pb.duration_seconds is not None:
            pb_ride = RouteHistoryPersonalBest(
                activity_id=pb.activity_id,
                date=pb.date,
                duration_seconds=pb.duration_seconds,
                average_power=pb.average_power,
            )

    return RouteHistoryResponse(
        route_id=route_id,
        route_name=route.name,
        total_rides=len(rides),
        personal_best=pb_ride,
        rides=rides,
    )


# ─── Merged Route View / Heatmap ──────────────────────────────────────────────


@router.get("/{route_id}/merged-view", response_model=MergedRouteView)
async def get_merged_route_view(
    route_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a merged route with each contributing source's polyline and ridden segments.

    Returns the route detail along with source-level polylines (for drawing each
    contributing route variant) and activity polylines for rides on this route
    (for highlighting ridden sections).
    """
    route = await route_service.get_route_by_id(db, route_id, current_user.id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    # Build the merged view from the route
    merged = MergedRouteView.model_validate(route)

    # Collect ridden segments: activities linked to this route with polyline data
    activities_result = await db.execute(
        select(Activity)
        .where(
            Activity.route_id == route_id,
            Activity.user_id == current_user.id,
        )
        .order_by(Activity.start_date.desc())
    )
    activities = list(activities_result.scalars().all())

    for activity in activities:
        encoded = _extract_encoded_polyline(activity)
        if encoded:
            merged.ridden_segments.append(
                RiddenSegment(
                    activity_id=activity.id,
                    encoded_polyline=encoded,
                    date=activity.start_date,
                    distance_meters=activity.distance_meters,
                    duration_seconds=activity.duration_seconds,
                )
            )

    return merged
