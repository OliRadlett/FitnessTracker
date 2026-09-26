"""Integration tests for the route service (expensive).

These tests exercise the route service functions directly with real DB.
No external APIs are mocked — only the database is used.

Run with:  pytest tests/integration/test_route_service.py -m integration
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.route import Route, RouteSource

pytestmark = [pytest.mark.integration, pytest.mark.expensive]


# ── Route Deduplication ──────────────────────────────────────────────────


class TestRouteDeduplication:
    """Route deduplication — same polyline → same route."""

    async def test_same_polyline_returns_existing_route(
        self,
        db_session,
        test_user,
        test_route,
    ):
        """Creating a route with the same polyline returns the existing route."""
        from app.services.route_service import find_duplicate_route

        duplicate = await find_duplicate_route(
            db_session,
            test_user.id,
            distance_meters=15000.0,
            encoded_polyline=test_route.encoded_polyline,
            name="Richmond Park Loop",
            start_lat=51.4430,
            start_lng=-0.2710,
            end_lat=51.4430,
            end_lng=-0.2710,
        )
        assert duplicate is not None
        assert duplicate.id == test_route.id

    async def test_different_polyline_returns_none(
        self,
        db_session,
        test_user,
        test_route,
    ):
        """Creating a route with a different polyline returns None."""
        from app.services.route_service import find_duplicate_route

        duplicate = await find_duplicate_route(
            db_session,
            test_user.id,
            distance_meters=30000.0,
            encoded_polyline="different_polyline_data_here",
            name="Completely Different Route",
            start_lat=52.0,
            start_lng=-1.0,
            end_lat=52.1,
            end_lng=-1.1,
        )
        assert duplicate is None


# ── Route Creation ───────────────────────────────────────────────────────


class TestRouteCreation:
    """Route creation from activity data."""

    async def test_create_route(self, db_session, test_user):
        """Creating a route stores it with computed start/end coordinates."""
        from app.services.route_service import create_route

        # Use a simple encoded polyline
        encoded = "o}~mH~}xMz@z@z@z@z@z@"
        route = await create_route(
            db_session,
            test_user.id,
            name="Test Route",
            sport_type="cycling",
            distance_meters=10000.0,
            encoded_polyline=encoded,
        )
        await db_session.flush()

        assert route.id is not None
        assert route.name == "Test Route"
        assert route.distance_meters == 10000.0
        assert route.start_lat is not None
        assert route.start_lng is not None
        assert route.end_lat is not None
        assert route.end_lng is not None

    async def test_create_route_with_source(self, db_session, test_user):
        """Creating a route with create_or_merge_route adds a RouteSource."""
        from app.services.route_service import create_or_merge_route

        encoded = "o}~mH~}xMz@z@z@z@z@z@"
        route = await create_or_merge_route(
            db_session,
            test_user.id,
            name="Test Route with Source",
            sport_type="cycling",
            distance_meters=10000.0,
            encoded_polyline=encoded,
            provider="strava",
            provider_route_id="strava_route_456",
            provider_name="Test Route with Source",
        )
        await db_session.flush()

        # Verify source was created
        result = await db_session.execute(
            select(RouteSource).where(RouteSource.route_id == route.id)
        )
        sources = list(result.scalars().all())
        assert len(sources) >= 1
        assert sources[0].provider == "strava"


# ── Route Listing ────────────────────────────────────────────────────────


class TestRouteListing:
    """Route listing with filters."""

    async def test_list_routes(self, db_session, test_user, test_route):
        """Listing routes returns all user routes."""
        from app.services.route_service import get_route_by_id

        route = await get_route_by_id(db_session, test_route.id, test_user.id)
        assert route is not None
        assert route.name == "Richmond Park Loop"

    async def test_get_nonexistent_route(self, db_session, test_user):
        """Getting a nonexistent route returns None."""
        from app.services.route_service import get_route_by_id

        route = await get_route_by_id(db_session, uuid.uuid4(), test_user.id)
        assert route is None


# ── Provider Source Ownership (RMI-09) ───────────────────────────────────


class TestRouteSourceOwnership:
    """RouteSources are scoped to the owning user."""

    async def _second_user(self, db_session):
        from app.models.user import User

        user = User(
            id=uuid.uuid4(), email="second@example.com", name="Second User"
        )
        db_session.add(user)
        await db_session.flush()
        return user

    async def test_same_provider_tour_gives_distinct_routes(
        self, db_session, test_user
    ):
        """Two users importing the same provider tour own distinct Routes."""
        from app.services.route_service import create_or_merge_route

        encoded = "o}~mH~}xMz@z@z@z@z@z@"
        kwargs = {
            "name": "Shared Komoot Tour",
            "sport_type": "cycling",
            "distance_meters": 12000.0,
            "encoded_polyline": encoded,
            "provider": "komoot",
            "provider_route_id": "komoot_tour_999",
            "provider_name": "Shared Komoot Tour",
        }
        route_a = await create_or_merge_route(db_session, test_user.id, **kwargs)
        user_b = await self._second_user(db_session)
        route_b = await create_or_merge_route(db_session, user_b.id, **kwargs)
        await db_session.flush()

        assert route_a.id != route_b.id
        assert route_a.user_id == test_user.id
        assert route_b.user_id == user_b.id

        sources = list(
            (
                await db_session.execute(
                    select(RouteSource).where(
                        RouteSource.provider == "komoot",
                        RouteSource.provider_route_id == "komoot_tour_999",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {s.user_id for s in sources} == {test_user.id, user_b.id}

    async def test_repeat_import_returns_own_route(self, db_session, test_user):
        """Re-importing returns the user's own route, not another's."""
        from app.services.route_service import create_or_merge_route

        encoded = "o}~mH~}xMz@z@z@z@z@z@"
        kwargs = {
            "name": "Shared Komoot Tour",
            "sport_type": "cycling",
            "distance_meters": 12000.0,
            "encoded_polyline": encoded,
            "provider": "komoot",
            "provider_route_id": "komoot_tour_999",
            "provider_name": "Shared Komoot Tour",
        }
        route_a = await create_or_merge_route(db_session, test_user.id, **kwargs)
        user_b = await self._second_user(db_session)
        await create_or_merge_route(db_session, user_b.id, **kwargs)
        again = await create_or_merge_route(db_session, test_user.id, **kwargs)
        assert again.id == route_a.id


# ── Derived-Data Invalidation (RMI-10) ───────────────────────────────────


class TestTerrainInvalidation:
    """Replacing a route's geometry clears stale derived data."""

    async def test_merge_upgrading_polyline_clears_terrain(
        self, db_session, test_user
    ):
        """Auto-merge with a higher-fidelity polyline resets terrain."""
        from app.services.polyline_utils import encode_polyline
        from app.services.route_service import create_route, merge_routes

        short_poly = encode_polyline([(51.0, -0.1), (51.01, -0.1)])
        long_poly = encode_polyline(
            [(51.0, -0.1), (51.01, -0.1), (51.02, -0.1), (51.03, -0.1)]
        )
        primary = await create_route(
            db_session,
            test_user.id,
            name="Primary",
            sport_type="cycling",
            distance_meters=3000.0,
            encoded_polyline=short_poly,
        )
        primary.terrain_classification = {"terrain_type": "flat"}
        duplicate = await create_route(
            db_session,
            test_user.id,
            name="Duplicate",
            sport_type="cycling",
            distance_meters=3000.0,
            encoded_polyline=long_poly,
        )
        await db_session.flush()

        merged = await merge_routes(
            db_session, primary.id, duplicate.id, test_user.id
        )
        await db_session.flush()

        assert merged is not None
        assert merged.id == primary.id
        assert merged.terrain_classification is None
        # The better geometry wins.
        assert merged.encoded_polyline == long_poly
