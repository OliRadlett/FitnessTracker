"""Komoot service — Basic Auth, route/tour sync.

Fetches tours (completed rides) and planned routes from Komoot's
reverse-engineered internal API (v007). Uses Basic Auth with
komoot_email/komoot_password from settings.

Enriches each route with:
- Coordinate streams for higher-fidelity polylines
- Surface/terrain breakdown
- Route type (planned vs recorded) stored in raw_data
"""

import logging
import uuid

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.komoot_client import komoot_client
from app.models.route import Route, RouteSource
from app.services.polyline_utils import (
    encode_polyline,
    komoot_coordinate_array_to_polyline,
    komoot_coordinates_to_polyline,
    polyline_total_distance,
)
from app.services.route_service import create_or_merge_route

logger = logging.getLogger(__name__)


def _extract_polyline_from_komoot_tour(tour: dict) -> str:
    """Extract encoded polyline from a Komoot tour/route.

    Komoot uses several formats:
    - _embedded.coordinate->coordinates: list of {lat, lng, alt}
    - coordinate: embedded resource with coordinates array
    - decoded_coordinate: pre-decoded polyline string
    """
    # Try decoded_coordinate first (some responses include this)
    if tour.get("decoded_coordinate"):
        return tour["decoded_coordinate"]

    # Try _embedded.coordinate
    embedded = tour.get("_embedded", {})
    coordinate_resource = embedded.get("coordinate", {})

    # Try coordinates array (list of dicts with lat/lng)
    coordinates = coordinate_resource.get("coordinates", [])
    if coordinates and isinstance(coordinates[0], dict):
        return komoot_coordinates_to_polyline(coordinates)

    # Try points array (list of [lng, lat, alt])
    if coordinates and isinstance(coordinates[0], list):
        return komoot_coordinate_array_to_polyline(coordinates)

    # Try direct coordinate field
    if "coordinate" in tour and isinstance(tour["coordinate"], dict):
        coords = tour["coordinate"].get("coordinates", [])
        if coords:
            if isinstance(coords[0], dict):
                return komoot_coordinates_to_polyline(coords)
            elif isinstance(coords[0], list):
                return komoot_coordinate_array_to_polyline(coords)

    raise ValueError(f"Cannot extract polyline from Komoot tour {tour.get('id', '?')}")


def _build_polyline_from_trackpoints(trackpoints: list[dict]) -> str | None:
    """Build an encoded polyline from full trackpoint data [{lat, lng, alt, t}].

    Returns a Google-encoded polyline string, or None if no valid points.
    """
    if not trackpoints:
        return None

    points: list[tuple[float, float]] = []
    for tp in trackpoints:
        lat = tp.get("lat") or tp.get("latitude")
        lng = tp.get("lng") or tp.get("lon") or tp.get("longitude")
        if lat is not None and lng is not None:
            points.append((float(lat), float(lng)))

    if not points:
        return None

    return encode_polyline(points)


def _extract_elevations_from_trackpoints(trackpoints: list[dict]) -> list[float | None]:
    """Extract elevation values from trackpoint data."""
    elevations: list[float | None] = []
    for tp in trackpoints:
        alt = tp.get("alt") or tp.get("altitude") or tp.get("elevation")
        elevations.append(float(alt) if alt is not None else None)
    return elevations


def _extract_surface_profile(surface_data: dict) -> dict[str, float] | None:
    """Normalize Komoot surface response into a clean {type: percentage} dict.

    Komoot surface data can come in various formats:
    - {"surfaces": [{"type": "asphalt", "percentage": 60}, ...]}
    - {"asphalt": 0.6, "gravel": 0.25, ...}
    - {"data": {"asphalt": 60, "gravel": 25, ...}}
    """
    if not surface_data:
        return None

    # Try array format
    surfaces = surface_data.get("surfaces") or surface_data.get("data")
    if isinstance(surfaces, list):
        result: dict[str, float] = {}
        for item in surfaces:
            if isinstance(item, dict):
                name = item.get("type") or item.get("name", "unknown")
                pct = (
                    item.get("percentage") or item.get("share") or item.get("value", 0)
                )
                # Normalize to 0-1 range if it looks like a percentage (0-100)
                if isinstance(pct, (int, float)) and pct > 1.0:
                    pct = pct / 100.0
                result[name] = float(pct)
        return result if result else None

    # Try direct key-value format
    if isinstance(surfaces, dict):
        result = {}
        for name, pct in surfaces.items():
            if isinstance(pct, (int, float)):
                if pct > 1.0:
                    pct = pct / 100.0
                result[name] = float(pct)
        return result if result else None

    # Try top-level key-value (e.g. {"asphalt": 0.6, ...})
    result = {}
    for key, value in surface_data.items():
        if key in ("_links", "_embedded", "id", "type"):
            continue
        if isinstance(value, (int, float)):
            if value > 1.0:
                value = value / 100.0
            result[key] = float(value)
    return result if result else None


def _map_komoot_sport_type(sport_type: str) -> str:
    """Map Komoot sport types to internal sport types."""
    mapping = {
        "mtb_race": "cycling",
        "mtb": "cycling",
        "road_race": "cycling",
        "touringbicycle": "cycling",
        "touringroadbicycle": "cycling",
        "racebike": "cycling",
        "e_mtb": "cycling",
        "e_touringbicycle": "cycling",
        "jogging": "running",
        "hike": "hiking",
        "touring_skate": "walking",
    }
    return mapping.get(sport_type, "cycling")


async def _enrich_and_create_route(
    db: AsyncSession,
    user_id: uuid.UUID,
    tour_data: dict,
    is_planned_route: bool = False,
    provider_id_prefix: str = "",
) -> tuple[bool, bool]:
    """Process a single Komoot tour/route: fetch coordinates, extract surface, create/merge.

    Returns (synced, was_existing).
    """
    tour_id = str(tour_data.get("id", ""))
    if not tour_id:
        return False, False

    provider_route_id = (
        f"{provider_id_prefix}{tour_id}" if provider_id_prefix else tour_id
    )

    # Cheap existence check BEFORE the expensive coordinate/surface fetches —
    # a fully-synced route must not be re-downloaded (and re-crawled) every
    # 2 hours. Routes missing surface data still fall through so the
    # surface backfill can complete (BUG-069).
    existing_result = await db.execute(
        select(Route)
        .join(Route.sources)
        .where(
            Route.user_id == user_id,
            RouteSource.provider == "komoot",
            RouteSource.provider_route_id == provider_route_id,
        )
    )
    existing_route_row = existing_result.scalar_one_or_none()
    if existing_route_row is not None and existing_route_row.surface_profile is not None:
        return False, True

    # Fetch full coordinates from the /coordinates/ endpoint
    # The tour list/detail doesn't include coordinate data — must fetch separately
    trackpoints: list[dict] = []
    try:
        trackpoints = await komoot_client.get_coordinates(tour_id=tour_id)
        logger.info(f"Tour {tour_id}: got {len(trackpoints)} trackpoints")
    except Exception as e:
        logger.warning(f"Failed to fetch coordinates for tour {tour_id}: {e}")

    if not trackpoints or len(trackpoints) < 2:
        logger.warning(
            f"Skipping Komoot tour {tour_id}: no coordinate data ({len(trackpoints)} points)"
        )
        return False, False

    polyline = _build_polyline_from_trackpoints(trackpoints)
    if not polyline:
        logger.warning(
            f"Skipping Komoot tour {tour_id}: could not build polyline from trackpoints"
        )
        return False, False

    # Extract surface data from tour summary (available in list/detail response)
    # Komoot uses keys like "sb#asphalt" (surface) and "wt#cycleway" (way type)
    surface_profile = None
    summary = tour_data.get("summary", {})
    if isinstance(summary, dict):
        surfaces_raw = summary.get("surfaces", {})
        if surfaces_raw and isinstance(surfaces_raw, dict):
            # Strip "sb#" prefix from surface keys
            normalized = {}
            for key, val in surfaces_raw.items():
                clean_key = key.split("#", 1)[1] if "#" in str(key) else str(key)
                if isinstance(val, (int, float)) and val > 0:
                    normalized[clean_key] = val
            if normalized:
                surface_profile = _extract_surface_profile({"data": normalized})
                if surface_profile:
                    logger.info(f"Tour {tour_id}: surface data from payload = {surface_profile}")

    # Fallback: call Komoot's dedicated surface endpoint if payload lacked data
    if not surface_profile:
        try:
            raw_surface = await komoot_client.get_surface(tour_id=tour_id)
            surface_profile = _extract_surface_profile(raw_surface)
            if surface_profile:
                logger.info(f"Tour {tour_id}: surface data from API = {surface_profile}")
        except Exception as e:
            logger.debug(f"Tour {tour_id}: surface API fallback failed: {e}")

    name = tour_data.get(
        "name", "Komoot Tour" if not is_planned_route else "Komoot Route"
    )
    distance = tour_data.get("distance", 0) or 0  # meters
    elevation_up = tour_data.get("elevation_up", 0) or 0
    duration = tour_data.get("duration", 0) or 0  # seconds
    sport_type = _map_komoot_sport_type(tour_data.get("sport", ""))

    if distance <= 0:
        distance = polyline_total_distance(polyline)

    # Build elevation profile from trackpoints
    elevation_profile = None
    elevations = _extract_elevations_from_trackpoints(trackpoints)
    if any(e is not None for e in elevations):
        elevation_profile = {"elevations": elevations}

    # Enrich raw_data with Komoot route type
    raw_data = dict(tour_data)
    raw_data["_komoot_type"] = "planned" if is_planned_route else "recorded"

    # Check if this was merged (existing source found)
    existing_source = await db.execute(
        select(Route)
        .join(Route.sources)
        .where(
            Route.user_id == user_id,
            Route.sources.any(
                and_(
                    RouteSource.provider == "komoot",
                    RouteSource.provider_route_id == provider_route_id,
                )
            ),
        )
    )
    was_existing = existing_source.first() is not None

    await create_or_merge_route(
        db,
        user_id,
        name=name,
        sport_type=sport_type,
        distance_meters=distance,
        encoded_polyline=polyline,
        provider="komoot",
        provider_route_id=provider_route_id,
        provider_name=name,
        elevation_gain_meters=elevation_up if elevation_up > 0 else None,
        estimated_time_seconds=duration if duration > 0 else None,
        elevation_profile=elevation_profile,
        surface_profile=surface_profile,
        raw_data=raw_data,
    )

    logger.info(f"Synced Komoot tour {tour_id}: '{name}' ({distance / 1000:.1f}km)")
    return True, was_existing


async def sync_komoot_routes(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 100,
) -> tuple[int, int]:
    """Fetch and store Komoot routes and tours for a user.

    Uses Basic Auth from settings (komoot_email/komoot_password).

    Returns (total_synced, merged_count).
    """
    # Authenticate via Basic Auth
    await komoot_client.ensure_authenticated()

    # Get Komoot user ID
    try:
        account = await komoot_client.get_account()
        komoot_user_id = str(account.get("username", account.get("user_id", "")))
        if not komoot_user_id:
            raise ValueError("Cannot determine Komoot user ID")
    except Exception as e:
        logger.error(f"Failed to get Komoot account info: {e}")
        return 0, 0

    synced_count = 0
    merged_count = 0

    # ── Sync completed tours ────────────────────────────────────────────────
    page = 0
    while synced_count < limit:
        try:
            tours = await komoot_client.get_tours(
                user_id=komoot_user_id,
                page=page,
                limit=50,
            )
        except Exception as e:
            logger.error(f"Failed to fetch Komoot tours page {page}: {e}")
            break

        if not tours:
            break

        for tour in tours:
            tour_id = str(tour.get("id", ""))
            if not tour_id:
                continue

            # The list endpoint returns tour summaries without coordinate data.
            # Fetch the full tour detail to get the polyline/coordinates.
            try:
                tour_detail = await komoot_client.get_tour_detail(tour_id=tour_id)
                tour.update(tour_detail)
            except Exception as e:
                logger.warning(f"Failed to fetch Komoot tour detail {tour_id}: {e}")

            synced, was_existing = await _enrich_and_create_route(
                db,
                user_id,
                tour,
                is_planned_route=False,
            )
            if synced:
                synced_count += 1
                if was_existing:
                    merged_count += 1

        page += 1
        if len(tours) < 50:
            break

    # ── Sync planned/saved routes ───────────────────────────────────────────
    # Safety cap: the planned-routes endpoint paginates with `while True`
    # in practice; bound it so a misbehaving API can't crawl forever.
    page = 0
    while page <= 50:
        try:
            routes = await komoot_client.get_routes(
                user_id=komoot_user_id,
                page=page,
                limit=50,
            )
        except Exception as e:
            logger.error(f"Failed to fetch Komoot routes page {page}: {e}")
            break

        if not routes:
            break

        for route_data in routes:
            route_id = str(route_data.get("id", ""))
            if not route_id:
                continue

            # Fetch full route detail for coordinates
            try:
                route_detail = await komoot_client.get_route_detail(route_id=route_id)
                route_data.update(route_detail)
            except Exception as e:
                logger.warning(f"Failed to fetch Komoot route detail {route_id}: {e}")

            synced, was_existing = await _enrich_and_create_route(
                db,
                user_id,
                route_data,
                is_planned_route=True,
                provider_id_prefix="route_",
            )
            if synced:
                synced_count += 1
                if was_existing:
                    merged_count += 1

        page += 1
        if len(routes) < 50:
            break

    logger.info(
        f"Komoot sync complete for user {user_id}: {synced_count} synced, {merged_count} merged"
    )

    # ── Backfill surface data for Komoot routes missing it ───────────────────
    backfill_count = 0
    try:
        result = await db.execute(
            select(Route)
            .join(Route.sources)
            .where(
                Route.user_id == user_id,
                Route.surface_profile.is_(None),
                RouteSource.provider == "komoot",
            )
        )
        routes_missing_surface = list(result.scalars().all())

        for route in routes_missing_surface:
            # Extract Komoot tour ID from the source's provider_route_id
            source_result = await db.execute(
                select(RouteSource.provider_route_id).where(
                    RouteSource.route_id == route.id,
                    RouteSource.provider == "komoot",
                )
            )
            provider_route_id = source_result.scalar_one_or_none()
            if not provider_route_id:
                continue

            # Strip "route_" prefix if present (planned routes)
            tour_id = provider_route_id.removeprefix("route_")

            try:
                raw_surface = await komoot_client.get_surface(tour_id=tour_id)
                surface_profile = _extract_surface_profile(raw_surface)
                if surface_profile:
                    route.surface_profile = surface_profile
                    backfill_count += 1
                    logger.info(f"Backfilled surface for route {route.id}: {surface_profile}")
            except Exception as e:
                logger.debug(f"Surface backfill failed for route {route.id}: {e}")

        if backfill_count > 0:
            await db.flush()
            logger.info(f"Backfilled surface data for {backfill_count} Komoot routes")
    except Exception as e:
        logger.warning(f"Surface backfill pass failed: {e}")

    return synced_count, merged_count
