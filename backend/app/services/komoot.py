"""Komoot service — Basic Auth, route/tour sync.

Fetches tours (completed rides) and planned routes from Komoot's
reverse-engineered internal API (v007). Uses Basic Auth with
komoot_email/komoot_password from settings.

Enriches each route with:
- Coordinate streams for higher-fidelity polylines
- Surface/terrain breakdown
- Route type (planned vs recorded) stored in raw_data
"""

import json
import logging
import uuid

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.komoot_client import komoot_client
from app.models.route import Route, RouteSource
from app.services.polyline_utils import (
    encode_polyline,
    extract_elevation_profile_from_komoot_trackpoints,
    komoot_coordinate_array_to_polyline,
    komoot_coordinates_to_polyline,
    polyline_total_distance,
)
from app.services.route_service import create_or_merge_route
from app.services.surface_types import clean_surface_type

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


def _surface_amount(item: dict) -> float | None:
    """Komoot uses ``amount``; the API fallback has used percentage/share."""
    for key in ("amount", "percentage", "share", "value", "fraction"):
        value = item.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    return None


def _extract_surface_profile(surface_data: dict | list | None) -> dict[str, float] | None:
    """Normalize Komoot surface data into {type: fraction}.

    Accepted shapes (all observed in the wild):

    - ``{"summary": {"surfaces": [{"type": "sb#asphalt", "amount": 1.0}]}}``
      (what the v007 tour payload actually stores — a **list**, not a dict)
    - ``{"surfaces": [{"type": "asphalt", "percentage": 60}, ...]}``
    - ``{"surfaces": {"asphalt": 0.6, ...}}`` / ``{"data": {...}}``
    - ``{"asphalt": 0.6, "gravel": 0.4}``

    Types are mapped onto the app's surface vocabulary (``paved``,
    ``gravel``, ``compacted_gravel``, …) and values are normalised to
    fractions summing to 1. Unknown way types (``wt#cycleway``) and
    ``sf#unknown`` are skipped rather than polluting the mix.
    """
    if not surface_data:
        return None

    raw: object = surface_data
    if isinstance(surface_data, dict):
        summary = surface_data.get("summary")
        if isinstance(summary, dict) and summary.get("surfaces"):
            raw = summary["surfaces"]
        else:
            raw = surface_data.get("surfaces") or surface_data.get("data") or surface_data

    pairs: list[tuple[str, float]] = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            name = clean_surface_type(item.get("type") or item.get("name") or "")
            amount = _surface_amount(item)
            if name and amount is not None and amount > 0:
                pairs.append((name, amount))
    elif isinstance(raw, dict):
        for key, value in raw.items():
            name = clean_surface_type(key)
            if name and isinstance(value, (int, float)) and value > 0:
                pairs.append((name, float(value)))

    if not pairs:
        return None

    # Some sources send 0–100 percentages; collapse to fractions.
    total = sum(value for _, value in pairs)
    if total > 1.5:
        pairs = [(name, value / 100.0) for name, value in pairs]
        total = sum(value for _, value in pairs)
    if total <= 0:
        return None

    merged: dict[str, float] = {}
    for name, value in pairs:
        merged[name] = merged.get(name, 0.0) + value / total

    return {name: round(value, 4) for name, value in merged.items() if value > 0}


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

    # Extract surface data from the tour payload. The v007 tour stores
    # ``summary.surfaces`` as a LIST of {type: "sb#asphalt", amount: 1.0};
    # the helper also accepts the older dict/API shapes.
    surface_profile = None
    summary = tour_data.get("summary", {})
    if isinstance(summary, dict):
        surface_profile = _extract_surface_profile(summary)
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

    # Build elevation profile from trackpoints (canonical
    # {"distance", "elevation"} shape so terrain classification works)
    elevation_profile = extract_elevation_profile_from_komoot_trackpoints(
        trackpoints
    )

    # Enrich raw_data with Komoot route type.
    #
    # Taken from the payload, not from which loop called this. The two loops
    # were not disjoint — the recorded-tour loop fetched planned routes too
    # — so labelling by call site wrote "recorded" onto thirty
    # tour_planned objects, contradicting the type in the same row. The
    # payload is the authority on what Komoot actually returned.
    raw_data = dict(tour_data)
    komoot_type = tour_data.get("type")
    if not komoot_type:
        komoot_type = "tour_planned" if is_planned_route else "tour_recorded"
    raw_data["_komoot_type"] = komoot_type

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
    # Filtered to tour_recorded, and the filter is load-bearing rather than
    # tidiness. Unfiltered, this call also returns every planned route, so
    # this loop re-ingested all of them under a bare id while the planned
    # loop ingested the same objects under a `route_`-prefixed id — two rows
    # per tour. All 57 Komoot sources in the database were tour_planned; not
    # one recorded tour had ever been picked up.
    #
    # Verified against the live API: tour_type="tour_recorded" returns zero
    # tours for this account (so this loop is currently a no-op, and will
    # start working the moment a ride is recorded), while "recorded" and
    # "planned" both return HTTP 400.
    page = 0
    while synced_count < limit:
        try:
            tours = await komoot_client.get_tours(
                user_id=komoot_user_id,
                page=page,
                limit=50,
                tour_type="tour_recorded",
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
            # Extract Komoot tour ID + the stored payload (surface lives in it)
            source_result = await db.execute(
                select(RouteSource.provider_route_id, RouteSource.raw_data).where(
                    RouteSource.route_id == route.id,
                    RouteSource.provider == "komoot",
                )
            )
            source_row = source_result.one_or_none()
            if source_row is None or not source_row.provider_route_id:
                continue
            provider_route_id, source_raw = source_row
            tour_id = provider_route_id.removeprefix("route_")

            surface_profile = None
            if source_raw:
                payload = json.loads(source_raw) if isinstance(source_raw, str) else source_raw
                if isinstance(payload, dict):
                    surface_profile = _extract_surface_profile(
                        payload.get("summary") or payload
                    )

            if not surface_profile:
                try:
                    raw_surface = await komoot_client.get_surface(tour_id=tour_id)
                    surface_profile = _extract_surface_profile(raw_surface)
                except Exception as e:
                    logger.debug(f"Surface backfill failed for route {route.id}: {e}")

            if surface_profile:
                route.surface_profile = surface_profile
                backfill_count += 1
                logger.info(f"Backfilled surface for route {route.id}: {surface_profile}")

        if backfill_count > 0:
            await db.flush()
            logger.info(f"Backfilled surface data for {backfill_count} Komoot routes")
    except Exception as e:
        logger.warning(f"Surface backfill pass failed: {e}")

    return synced_count, merged_count
