"""Smart-collection surface OR + normalized power in cached ride context.

- ``evaluate_smart_collection`` with ``surface_type: [a, b]`` matches routes
  containing ANY of the surfaces (was AND).
- ``analyze_ride`` exposes ``normalized_power`` so the §1.3 cached context
  (``ride_context_from_analysis``) carries it instead of ``None``.
Run with: pytest tests/integration/test_smart_collection_and_context.py
-m integration
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.activity import Activity, ActivityStream
from app.models.route import Route
from app.models.route_organize import RouteCollection
from app.services.activity_context import (
    compute_activity_context,
    context_to_ride_metrics,
)
from app.services.route_collection_rules import evaluate_smart_collection
from app.services.session_analysis import analyze_ride

pytestmark = pytest.mark.integration


def _route(db_session, user_id, name, surface) -> Route:
    route = Route(
        user_id=user_id,
        name=name,
        sport_type="cycling",
        distance_meters=10000.0,
        encoded_polyline="o}~mH~}xMz@z@z@z@z@z@",
        start_lat=51.4430,
        start_lng=-0.2710,
        end_lat=51.4430,
        end_lng=-0.2710,
        is_loop=True,
        surface_profile=surface,
    )
    db_session.add(route)
    return route


class TestSurfaceOrSemantics:
    async def test_matches_any_listed_surface(self, db_session, test_user):
        _route(db_session, test_user.id, "Paved Loop", {"paved": 100})
        _route(db_session, test_user.id, "Gravel Ride", {"gravel": 100})
        _route(db_session, test_user.id, "Mixed", {"paved": 50, "dirt": 50})
        await db_session.flush()
        coll = RouteCollection(
            user_id=test_user.id,
            name="Off-road-ish",
            is_smart=True,
            rules={"surface_type": ["gravel", "dirt"]},
        )
        db_session.add(coll)
        await db_session.flush()

        matched = await evaluate_smart_collection(db_session, test_user.id, coll.id)

        assert sorted(r.name for r in matched) == ["Gravel Ride", "Mixed"]


class TestNormalizedPowerInContext:
    async def test_context_carries_np(self, db_session, test_user):
        activity = Activity(
            user_id=test_user.id,
            source="strava",
            sport_type="cycling",
            name="Steady",
            start_date=datetime.now(UTC) - timedelta(days=1),
            duration_seconds=300,
            average_power=200.0,
            provider_activity_id=f"strava_np_{uuid.uuid4().hex[:8]}",
        )
        db_session.add(activity)
        await db_session.flush()
        db_session.add(
            ActivityStream(
                activity_id=activity.id,
                stream_type="watts",
                data={"data": [200.0] * 300},
                resolution=1,
            )
        )
        await db_session.flush()

        analysis = await analyze_ride(db_session, test_user.id, activity.id)
        assert analysis["normalized_power"] == pytest.approx(200.0, abs=0.5)

        ride = context_to_ride_metrics(
            await compute_activity_context(db_session, activity)
        )
        assert ride["normalized_power"] == pytest.approx(200.0, abs=0.5)
