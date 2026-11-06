"""Geometry-only similarity scan regression.

The scan used to skip every pair when both road and embedding signals were
missing. That is the default state for most accounts (0/86 road matches on the
fixture), so the cache emptied itself and the suggestions page had nothing to
show. Road signals are optional enrichment; the geometric engine must still run.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.route import Route, RouteSimilarity
from app.models.user import User

pytestmark = pytest.mark.integration

ENCODED = "o}~mH~}xMz@z@z@z@z@z@"


async def test_scan_writes_geometry_only_pairs(test_engine, monkeypatch):
    from app.integrations import route_intelligence
    from app.services import road_matching
    from app.services.route_similarity import recompute_user_similarity

    async with AsyncSession(test_engine, expire_on_commit=False) as db:
        user = User(
            id=uuid.uuid4(),
            email=f"scan-{uuid.uuid4().hex[:8]}@example.com",
            name="Scan",
        )
        db.add(user)
        await db.flush()
        a = Route(
            user_id=user.id,
            name="Loop A",
            sport_type="cycling",
            distance_meters=10_000,
            encoded_polyline=ENCODED,
            start_lat=51.0,
            start_lng=-1.0,
            end_lat=51.0,
            end_lng=-1.0,
            is_loop=True,
        )
        b = Route(
            user_id=user.id,
            name="Loop B",
            sport_type="cycling",
            distance_meters=10_000,
            encoded_polyline=ENCODED,
            start_lat=51.0,
            start_lng=-1.0,
            end_lat=51.0,
            end_lng=-1.0,
            is_loop=True,
        )
        db.add_all([a, b])
        await db.commit()

        monkeypatch.setattr(
            route_intelligence,
            "compute_route_similarity_on_modal",
            lambda *args, **kwargs: {
                "pairs": [
                    {
                        "a": str(a.id),
                        "b": str(b.id),
                        "total": 0.7,
                        "tier": "review",
                    }
                ]
            },
        )
        monkeypatch.setattr(
            road_matching, "road_signals", lambda *_args, **_kwargs: (None, None)
        )

        result = await recompute_user_similarity(db, user.id)
        assert result["status"] == "ready"

        count = (
            await db.execute(
                select(func.count(RouteSimilarity.id)).where(
                    RouteSimilarity.user_id == user.id
                )
            )
        ).scalar_one()
        assert count == 1
        row = (
            await db.execute(
                select(RouteSimilarity).where(RouteSimilarity.user_id == user.id)
            )
        ).scalar_one()
        assert row.tier in ("review", "auto")
        assert row.score > 0.8
        assert row.breakdown is not None

        await db.execute(delete(User).where(User.id == user.id))
        await db.commit()
