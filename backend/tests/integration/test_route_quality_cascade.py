"""A route with a quality row must be deletable.

Deleting a route failed with::

    asyncpg.exceptions.NotNullViolationError: null value in column
    "route_id" of relation "route_quality" violates not-null constraint

``route_quality.route_id`` is ``NOT NULL`` and its FK is ``ON DELETE CASCADE``
at the database level — so the database is set up to delete the child row. But
``Route.quality`` was declared with no cascade and no ``passive_deletes``, so
SQLAlchemy treated the delete as a de-association and tried to set the child's
foreign key to NULL first. The database never got to apply its own cascade.

This is not specific to the cleanup that surfaced it: **any** route that has
been quality-scored could not be deleted, which includes the ``DELETE /routes``
endpoint and every merge, since ``merge_routes`` also deletes the duplicate.
Every other child relationship on ``Route`` carries ``delete-orphan`` or sits
on a nullable FK; ``quality`` was the only one with neither.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.route import Route
from app.models.route_organize import RouteQuality
from app.services.route_service import delete_route

# Applied to the async class below rather than module-wide: a module-level
# `pytest.mark.asyncio` also lands on the synchronous declaration test at the
# bottom, and pytest warns it is not an async function. That noise would sit in
# the output of every run and mask real warnings about this file.

POLY = "o}~mH~}xMz@z@z@z@z@z@"


async def _route(db: AsyncSession, user_id) -> Route:
    route = Route(
        user_id=user_id,
        name="Cycling",
        sport_type="cycling",
        distance_meters=15000.0,
        encoded_polyline=POLY,
        start_lat=51.4,
        start_lng=-0.2,
        end_lat=51.4,
        end_lng=-0.2,
        is_loop=True,
    )
    db.add(route)
    await db.flush()
    return route


async def _quality(db: AsyncSession, route: Route, user_id) -> RouteQuality:
    q = RouteQuality(
        route_id=route.id,
        user_id=user_id,
        completeness_score=0.5,
        popularity_score=0.5,
        surface_quality_score=0.5,
        effort_match_score=0.5,
        overall_score=0.5,
    )
    db.add(q)
    await db.flush()
    return q


class TestDeletingAQualityScoredRoute:
    @pytest.mark.asyncio
    async def test_delete_succeeds_when_a_quality_row_exists(
        self, db_session: AsyncSession, test_user
    ):
        route = await _route(db_session, test_user.id)
        await _quality(db_session, route, test_user.id)
        await db_session.commit()

        assert await delete_route(db_session, route.id, test_user.id) is True
        await db_session.commit()

        remaining = (
            await db_session.execute(
                select(Route).where(Route.id == route.id)
            )
        ).scalars().all()
        assert not remaining, "the route survived deletion"

    @pytest.mark.asyncio
    async def test_the_quality_row_is_cascaded_away(
        self, db_session: AsyncSession, test_user
    ):
        """Not left orphaned pointing at a route that no longer exists."""
        route = await _route(db_session, test_user.id)
        q = await _quality(db_session, route, test_user.id)
        qid = q.id
        await db_session.commit()

        await delete_route(db_session, route.id, test_user.id)
        await db_session.commit()

        rows = (
            await db_session.execute(
                select(RouteQuality).where(RouteQuality.id == qid)
            )
        ).scalars().all()
        assert not rows, "route_quality row was orphaned, not cascaded"


class TestTheRelationshipIsDeclaredCorrectly:
    def test_quality_uses_passive_deletes(self):
        """Guards the fix at the declaration.

        Removing ``passive_deletes`` restores the failure, and the runtime
        error names a table rather than the relationship — so the next person
        to see it would not know where to look.
        """
        rel = Route.quality.property
        assert rel.passive_deletes is True, (
            "Route.quality must set passive_deletes=True so the database's "
            "ON DELETE CASCADE applies instead of SQLAlchemy nulling a "
            "NOT NULL foreign key"
        )
