"""Integration tests for non-destructive route merge + undo.

Run with:  pytest tests/integration/test_route_merge.py -m integration
(Fixtures create the test database and roll back each test transactionally.)
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select

from app.models.activity import Activity
from app.models.route import Route, RouteMergeLog
from app.models.route_organize import (
    RouteCollection,
    RouteCollectionItem,
    RouteQuality,
    RouteTag,
    RouteTagging,
)
from app.models.segment import Segment
from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.services.polyline_utils import encode_polyline
from app.services.route_service import create_route, merge_routes, undo_route_merge

pytestmark = [pytest.mark.integration, pytest.mark.expensive]


def _line(km: float, n: int = 101):
    lat0 = 55.0
    cos = math.cos(math.radians(lat0))
    dist = km * 1000.0
    return [(lat0, i / (n - 1) * (dist / (111_320.0 * cos))) for i in range(n)]


@pytest.fixture
def route_family():
    """Return a factory that builds primary + duplicate with linked children."""
    return _build_route_family


async def _build_route_family(db_session, user):
    enc = encode_polyline(_line(40.0))
    primary = await create_route(db_session, user.id, "Primary", "cycling", 40_000.0, enc)
    dup = await create_route(db_session, user.id, "Dup", "cycling", 40_000.0, enc)

    tag = RouteTag(user_id=user.id, name="loop")
    coll = RouteCollection(user_id=user.id, name="c")
    db_session.add_all([tag, coll])
    await db_session.flush()
    db_session.add(RouteTagging(route_id=dup.id, tag_id=tag.id))
    db_session.add(RouteCollectionItem(collection_id=coll.id, route_id=dup.id))
    db_session.add(RouteQuality(route_id=dup.id, user_id=user.id, overall_score=0.8))
    activity = Activity(
        user_id=user.id,
        route_id=dup.id,
        source="strava",
        sport_type="cycling",
        name="Ride",
        start_date=datetime.now(UTC),
        duration_seconds=3600,
        distance_meters=40_000.0,
    )
    db_session.add(activity)
    plan = TrainingPlan(
        user_id=user.id,
        name="P",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 28),
    )
    db_session.add(plan)
    await db_session.flush()
    plan_day = TrainingPlanDay(
        plan_id=plan.id,
        day_date=date(2026, 1, 5),
        sport="cycle",
        planned_type="easy",
        planned_route_id=dup.id,
    )
    db_session.add(plan_day)
    segment = Segment(
        user_id=user.id,
        route_id=dup.id,
        name="Climb",
        start_dist_m=0.0,
        end_dist_m=1000.0,
        distance_m=1000.0,
        elevation_gain_m=50.0,
        avg_gradient_pct=5.0,
        max_gradient_pct=8.0,
        start_lat=55.0,
        start_lng=0.0,
        end_lat=55.0,
        end_lng=0.01,
    )
    db_session.add(segment)
    await db_session.flush()
    return {
        "primary": primary,
        "dup": dup,
        "tag": tag,
        "collection": coll,
        "activity": activity,
        "plan_day": plan_day,
        "segment": segment,
    }


async def test_merge_remaps_children_and_unions_metadata(db_session, test_user):
    fam = await _build_route_family(db_session, test_user)
    primary, dup = fam["primary"], fam["dup"]

    merged = await merge_routes(
        db_session, primary.id, dup.id, test_user.id, score=0.95, breakdown={"x": 1}
    )
    assert merged is not None and merged.id == primary.id

    # Duplicate is gone
    assert (
        await db_session.execute(select(Route).where(Route.id == dup.id))
    ).scalar_one_or_none() is None

    # Children remapped (not unlinked/destroyed)
    assert (
        await db_session.execute(
            select(Activity).where(Activity.id == fam["activity"].id)
        )
    ).scalar_one().route_id == primary.id
    assert (
        await db_session.execute(
            select(TrainingPlanDay).where(TrainingPlanDay.id == fam["plan_day"].id)
        )
    ).scalar_one().planned_route_id == primary.id
    assert (
        await db_session.execute(
            select(Segment).where(Segment.id == fam["segment"].id)
        )
    ).scalar_one().route_id == primary.id
    assert (
        await db_session.execute(
            select(RouteTagging).where(
                RouteTagging.route_id == primary.id,
                RouteTagging.tag_id == fam["tag"].id,
            )
        )
    ).scalar_one_or_none() is not None
    assert (
        await db_session.execute(
            select(RouteCollectionItem).where(
                RouteCollectionItem.route_id == primary.id,
                RouteCollectionItem.collection_id == fam["collection"].id,
            )
        )
    ).scalar_one_or_none() is not None
    assert (
        await db_session.execute(
            select(RouteQuality).where(RouteQuality.route_id == primary.id)
        )
    ).scalar_one_or_none() is not None

    # Audit log written
    assert (
        await db_session.execute(
            select(RouteMergeLog).where(RouteMergeLog.primary_route_id == primary.id)
        )
    ).scalar_one_or_none() is not None


async def test_undo_restores_route_and_children(db_session, test_user):
    fam = await _build_route_family(db_session, test_user)
    primary, dup = fam["primary"], fam["dup"]

    await merge_routes(db_session, primary.id, dup.id, test_user.id, score=0.9)
    log = (
        await db_session.execute(
            select(RouteMergeLog).where(RouteMergeLog.primary_route_id == primary.id)
        )
    ).scalar_one()

    restored = await undo_route_merge(db_session, log.id, test_user.id)
    assert restored is not None and restored.id == dup.id

    assert (
        await db_session.execute(
            select(Activity).where(Activity.id == fam["activity"].id)
        )
    ).scalar_one().route_id == dup.id
    assert (
        await db_session.execute(
            select(TrainingPlanDay).where(TrainingPlanDay.id == fam["plan_day"].id)
        )
    ).scalar_one().planned_route_id == dup.id
    assert (
        await db_session.execute(
            select(Segment).where(Segment.id == fam["segment"].id)
        )
    ).scalar_one().route_id == dup.id
    assert (
        await db_session.execute(
            select(RouteTagging).where(
                RouteTagging.route_id == dup.id,
                RouteTagging.tag_id == fam["tag"].id,
            )
        )
    ).scalar_one_or_none() is not None
    assert (
        await db_session.execute(
            select(RouteQuality).where(RouteQuality.route_id == dup.id)
        )
    ).scalar_one_or_none() is not None


async def test_merge_log_stores_embeddings_for_metric_training(
    db_session, test_user
):
    """The merge log must capture both embeddings, since the duplicate's Route
    row (and therefore its embedding) is deleted on merge.

    Regression: ``train_metric_from_history`` sourced positives from
    ``route_similarity.tier == "auto"``, which is always empty because merged
    pairs are removed from that table — so the metric never trained.
    """
    fam = await _build_route_family(db_session, test_user)
    primary, dup = fam["primary"], fam["dup"]

    prim_vec = [0.1] * 41
    dup_vec = [0.2] * 41
    primary.road_embedding = {"version": 1, "features": prim_vec}
    dup.road_embedding = {"version": 1, "features": dup_vec}
    await db_session.flush()

    await merge_routes(db_session, primary.id, dup.id, test_user.id, score=0.9)

    log = (
        await db_session.execute(
            select(RouteMergeLog).where(RouteMergeLog.primary_route_id == primary.id)
        )
    ).scalar_one()
    assert (log.snapshot or {})["road_embedding"]["features"] == dup_vec
    assert (log.breakdown or {})["primary_embedding"]["features"] == prim_vec


async def test_train_metric_from_merge_history(db_session, test_user):
    """End-to-end: merges recorded in the log yield a trained metric row."""
    from app.models.route import RouteMatchMetric
    from app.services.road_matching import train_metric_from_history

    # 4 merges → ≥3 positives; plus several surviving routes as negatives.
    for i in range(4):
        enc = encode_polyline(_line(10.0 + i))
        prim = await create_route(
            db_session, test_user.id, f"P{i}", "cycling", 10_000.0, enc
        )
        dup = await create_route(
            db_session, test_user.id, f"D{i}", "cycling", 10_000.0, enc
        )
        prim.road_embedding = {"version": 1, "features": [0.1] * 41}
        dup.road_embedding = {"version": 1, "features": [0.15] * 41}
        await db_session.flush()
        await merge_routes(db_session, prim.id, dup.id, test_user.id, score=0.9)

    # Surviving routes become the negative pool.
    for i in range(6):
        enc = encode_polyline(_line(50.0 + i))
        r = await create_route(
            db_session, test_user.id, f"N{i}", "cycling", 50_000.0, enc
        )
        r.road_embedding = {"version": 1, "features": [float(i) / 6.0] * 41}
    await db_session.flush()

    metric = await train_metric_from_history(db_session, test_user.id)
    assert len(metric.weights) == 41

    row = (
        await db_session.execute(
            select(RouteMatchMetric).where(RouteMatchMetric.user_id == test_user.id)
        )
    ).scalar_one()
    assert row.n_positives == 4
    assert row.n_negatives >= 3

