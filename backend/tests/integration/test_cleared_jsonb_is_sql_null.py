"""Clearing a JSONB column must produce SQL ``NULL``, not JSON ``null``.

``JSONB`` serialises a Python ``None`` as the JSON value ``null`` unless the
type is constructed with ``none_as_null=True``. Those are different things to
Postgres: a column holding JSON ``null`` is non-null, so ``IS NULL`` does not
match it.

That matters because the road-match columns are cleared — assigned ``None`` —
whenever a route's or activity's geometry changes, and the map-matching tasks
select on ``WHERE road_match IS NULL`` to find work left to do. Under the
default, a cleared route was silently never re-matched.

This was not caught by any unit test. Both halves are needed to see it: the
Python-level attribute reads back as ``None`` either way, so an ORM-level
assertion passes for the wrong reason. Only a round-trip through the database
and back out as raw SQL distinguishes them, which is what these tests do.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.route import Route

pytestmark = pytest.mark.asyncio

# Columns whose "cleared" state is expressed as SQL NULL. Each is invalidated
# by a geometry change and re-populated by a Modal worker, so a None that
# fails to clear is a permanently stale value.
CLEARED = ("road_match", "road_embedding", "terrain_classification")


async def _is_sql_null(
    db: AsyncSession, table: str, columns: tuple[str, ...], row_id
) -> dict[str, bool]:
    """Read the columns back as raw SQL, bypassing the ORM entirely."""
    result = await db.execute(
        text(
            f"SELECT {', '.join(f'{c} IS NULL AS {c}' for c in columns)} "
            f"FROM {table} WHERE id = :rid"
        ),
        {"rid": row_id},
    )
    return dict(result.mappings().one())


class TestClearedColumnsAreReallyNull:
    async def test_route_road_match_clears_to_sql_null(
        self, db_session: AsyncSession, test_route: Route
    ):
        test_route.road_match = {"version": 1, "edge_ids": [1, 2, 3]}
        test_route.road_embedding = {"dims": [0.1, 0.2]}
        test_route.terrain_classification = {"surface": "asphalt"}
        await db_session.flush()

        # The whole point: these must be non-null *before* clearing, or the
        # assertion below would pass without exercising anything.
        before = await _is_sql_null(db_session, "routes", CLEARED, test_route.id)
        assert not any(before.values()), f"nothing was set: {before}"

        test_route.road_match = None
        test_route.road_embedding = None
        test_route.terrain_classification = None
        await db_session.flush()
        await db_session.refresh(test_route)

        after = await _is_sql_null(db_session, "routes", CLEARED, test_route.id)
        assert all(after.values()), (
            f"assigning None stored JSON null rather than SQL NULL: {after}. "
            "A map-matching task filtering on `IS NULL` would skip this route."
        )

    async def test_activity_road_match_clears_to_sql_null(
        self, db_session: AsyncSession, test_activity: Activity
    ):
        test_activity.road_match = {"version": 1, "edge_ids": [7, 8]}
        test_activity.road_embedding = {"dims": [0.3]}
        await db_session.flush()

        test_activity.road_match = None
        test_activity.road_embedding = None
        await db_session.flush()
        await db_session.refresh(test_activity)

        after = await _is_sql_null(
            db_session, "activities", ("road_match", "road_embedding"), test_activity.id
        )
        assert all(after.values()), f"JSON null written to activities: {after}"


class TestTheColumnsAreDeclaredForIt:
    def test_types_opt_into_none_as_null(self):
        """Guards against a future edit dropping the flag.

        The behaviour above is only correct because of this declaration. A
        colleague tidying the model back to a bare ``JSONB`` would silently
        reintroduce the bug, and no other test would notice.
        """
        for model, columns in (
            (Route, CLEARED),
            (Activity, ("road_match", "road_embedding")),
        ):
            for name in columns:
                col = model.__table__.columns[name]
                assert col.type.none_as_null is True, (
                    f"{model.__name__}.{name} must be JSONB(none_as_null=True)"
                )

    async def test_a_cleared_route_is_offered_to_map_matching(
        self, db_session: AsyncSession, test_route: Route
    ):
        """The predicate the tasks actually run must now select the route."""
        test_route.road_match = {"version": 1}
        await db_session.flush()

        matched = (
            (
                await db_session.execute(
                    select(Route).where(
                        Route.id == test_route.id, Route.road_match.is_(None)
                    )
                )
            )
            .scalars()
            .all()
        )
        assert not matched, "sanity: not offered while a match is stored"

        test_route.road_match = None
        await db_session.flush()

        offered = (
            (
                await db_session.execute(
                    select(Route).where(
                        Route.id == test_route.id, Route.road_match.is_(None)
                    )
                )
            )
            .scalars()
            .all()
        )
        assert offered, (
            "a route with a cleared road match is not selected by "
            "`road_match IS NULL` — it would never be re-matched after its "
            "geometry changes"
        )
