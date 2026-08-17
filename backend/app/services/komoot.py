"""Komoot service — OAuth helper, token refresh, route sync."""

import uuid
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.komoot_client import komoot_client
from app.models.user import OAuthConnection
from app.models.route import Route
from app.services.polyline_utils import (
    komoot_coordinates_to_polyline,
    komoot_coordinate_array_to_polyline,
    polyline_total_distance,
    decode_polyline,
)
from app.services.route_service import create_or_merge_route

logger = logging.getLogger(__name__)


async def get_komoot_connection(db: AsyncSession, user_id: uuid.UUID) -> OAuthConnection | None:
    """Get the Komoot OAuth connection for a user."""
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == "komoot",
        )
    )
    return result.scalar_one_or_none()


async def refresh_if_needed(db: AsyncSession, connection: OAuthConnection) -> OAuthConnection:
    """Refresh the access token if it's expired."""
    if connection.token_expires_at and connection.token_expires_at < datetime.now(timezone.utc):
        if not connection.refresh_token:
            raise ValueError("No refresh token available")
        token_data = await komoot_client.refresh_access_token(connection.refresh_token)
        connection.access_token = token_data["access_token"]
        connection.refresh_token = token_data.get("refresh_token", connection.refresh_token)
        if "expires_in" in token_data:
            connection.token_expires_at = datetime.now(timezone.utc).replace(
                second=0
            ) + __import__("datetime").timedelta(seconds=int(token_data["expires_in"]))
        await db.flush()
    return connection


def _extract_polyline_from_komoot_tour(tour: dict) -> str:
    """Extract encoded polyline from a Komoot tour/route.

    Komoot uses several formats:
    - _embedded.coordinate->coordinates: list of {lat, lng, alt}
    - coordinate: embedded resource with coordinates array
    - decoded_coordinate: pre-decoded polyline string
    """
    # Try decoded_coordinate first (some responses include this)
    if "decoded_coordinate" in tour and tour["decoded_coordinate"]:
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


async def sync_komoot_routes(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 100,
) -> tuple[int, int]:
    """Fetch and store Komoot routes and tours for a user.

    Returns (total_synced, merged_count).
    """
    connection = await get_komoot_connection(db, user_id)
    if not connection:
        raise ValueError("No Komoot connection found")

    connection = await refresh_if_needed(db, connection)

    # Get Komoot user ID
    account = await komoot_client.get_account(connection.access_token)
    komoot_user_id = str(account.get("username", connection.provider_user_id))

    synced_count = 0
    merged_count = 0

    # Sync tours (completed rides)
    page = 0
    while synced_count < limit:
        try:
            tours = await komoot_client.get_tours(
                connection.access_token, komoot_user_id, page=page, limit=50,
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

            try:
                polyline = _extract_polyline_from_komoot_tour(tour)
            except ValueError:
                logger.warning(f"Skipping Komoot tour {tour_id}: no polyline data")
                continue

            name = tour.get("name", "Komoot Tour")
            distance = tour.get("distance", 0) or 0  # meters
            elevation_up = tour.get("elevation_up", 0) or 0
            duration = tour.get("duration", 0) or 0  # seconds
            sport_type = _map_komoot_sport_type(tour.get("sport", ""))

            if distance <= 0:
                # Compute from polyline
                distance = polyline_total_distance(polyline)

            # Check if this was merged (existing source found)
            existing_source = await db.execute(
                select(Route).join(Route.sources).where(
                    Route.user_id == user_id,
                    Route.sources.any(provider="komoot", provider_route_id=tour_id),  # type: ignore
                )
            )
            was_existing = existing_source.scalar_one_or_none() is not None

            await create_or_merge_route(
                db, user_id,
                name=name,
                sport_type=sport_type,
                distance_meters=distance,
                encoded_polyline=polyline,
                provider="komoot",
                provider_route_id=tour_id,
                provider_name=name,
                elevation_gain_meters=elevation_up if elevation_up > 0 else None,
                estimated_time_seconds=duration if duration > 0 else None,
                raw_data=tour,
            )

            synced_count += 1
            if was_existing:
                merged_count += 1

        page += 1
        if len(tours) < 50:
            break

    # Sync planned routes
    page = 0
    while True:
        try:
            routes = await komoot_client.get_routes(
                connection.access_token, komoot_user_id, page=page, limit=50,
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

            try:
                polyline = _extract_polyline_from_komoot_tour(route_data)
            except ValueError:
                logger.warning(f"Skipping Komoot route {route_id}: no polyline data")
                continue

            name = route_data.get("name", "Komoot Route")
            distance = route_data.get("distance", 0) or 0
            elevation_up = route_data.get("elevation_up", 0) or 0
            sport_type = _map_komoot_sport_type(route_data.get("sport", ""))

            if distance <= 0:
                distance = polyline_total_distance(polyline)

            await create_or_merge_route(
                db, user_id,
                name=name,
                sport_type=sport_type,
                distance_meters=distance,
                encoded_polyline=polyline,
                provider="komoot",
                provider_route_id=f"route_{route_id}",
                provider_name=name,
                elevation_gain_meters=elevation_up if elevation_up > 0 else None,
                raw_data=route_data,
            )
            synced_count += 1

        page += 1
        if len(routes) < 50:
            break

    logger.info(f"Komoot sync complete for user {user_id}: {synced_count} synced, {merged_count} merged")
    return synced_count, merged_count
