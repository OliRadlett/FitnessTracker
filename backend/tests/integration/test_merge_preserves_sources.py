"""``merge_routes`` must transfer the duplicate's sources, not lose them.

Found while converging the eleven byte-identical Komoot twins. Each pair held
one Komoot source under a ``route_``-prefixed id and the other under the bare
id. After merging, every survivor held exactly **one** source — the other
spelling had vanished, with nothing orphaned.

``merge_routes`` re-parents them explicitly::

    for source in duplicate.sources:
        source.route_id = primary.id

so the intent is transfer. If that silently degrades to delete, it does so for
*every* merge, not just these: a duplicate's source can be the only record
that a provider issued a given id, and losing it means the next sync misses
the exact-source lookup for that id.

Suspected cause is flush ordering. ``db.delete(duplicate)`` snapshots the
duplicate's children at the moment it is called and cascades over them; the
re-parenting marks an UPDATE on the same rows, and the DELETE can win. These
tests pin the behaviour down rather than leaving it as a theory.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.route import Route, RouteSource
from app.services.route_service import merge_routes

pytestmark = pytest.mark.asyncio

POLY_A = "o}~mH~}xMz@z@z@z@z@z@"
POLY_B = "o}~mH~}xMz@z@z@z@z@z@z@z@"


async def _route(db: AsyncSession, user_id, name: str, poly: str) -> Route:
    route = Route(
        user_id=user_id,
        name=name,
        sport_type="cycling",
        distance_meters=15000.0,
        encoded_polyline=poly,
        start_lat=51.4,
        start_lng=-0.2,
        end_lat=51.4,
        end_lng=-0.2,
        is_loop=True,
    )
    db.add(route)
    await db.flush()
    return route


async def _source(db: AsyncSession, route: Route, user_id, pid: str):
    db.add(
        RouteSource(
            route_id=route.id,
            user_id=user_id,
            provider="komoot",
            provider_route_id=pid,
            provider_name=route.name,
            encoded_polyline=route.encoded_polyline,
        )
    )
    await db.flush()


async def _sources_on(db: AsyncSession, route_id) -> list[str]:
    return [
        pid
        for (pid,) in (
            await db.execute(
                select(RouteSource.provider_route_id).where(
                    RouteSource.route_id == route_id
                )
            )
        ).all()
    ]


class TestSourcesSurviveAMerge:
    async def test_both_provider_ids_are_retained(
        self, db_session: AsyncSession, test_user
    ):
        primary = await _route(db_session, test_user.id, "Keep", POLY_A)
        duplicate = await _route(db_session, test_user.id, "Drop", POLY_B)
        await _source(db_session, primary, test_user.id, "route_999")
        await _source(db_session, duplicate, test_user.id, "999")
        await db_session.flush()

        survivor = await merge_routes(
            db_session, primary.id, duplicate.id, test_user.id
        )
        await db_session.commit()
        assert survivor is not None

        kept = await _sources_on(db_session, primary.id)
        assert sorted(kept) == ["999", "route_999"], (
            f"merge kept only {kept}; the duplicate's provider id was lost, so "
            "the next sync for it will miss the exact-source lookup"
        )

    async def test_no_source_is_orphaned(
        self, db_session: AsyncSession, test_user
    ):
        """A dropped row must not leave its source pointing at nothing."""
        primary = await _route(db_session, test_user.id, "Keep", POLY_A)
        duplicate = await _route(db_session, test_user.id, "Drop", POLY_B)
        await _source(db_session, primary, test_user.id, "route_999")
        await _source(db_session, duplicate, test_user.id, "999")
        await db_session.flush()

        await merge_routes(db_session, primary.id, duplicate.id, test_user.id)
        await db_session.commit()

        live = (
            await db_session.execute(select(func.count()).select_from(RouteSource))
        ).scalar_one()
        dangling = (
            await db_session.execute(
                select(func.count())
                .select_from(RouteSource)
                .where(RouteSource.route_id.notin_(select(Route.id)))
            )
        ).scalar_one()
        assert dangling == 0, f"{dangling} sources point at a deleted route"
        assert live == 2, f"expected both sources to exist, found {live}"

    async def test_sources_from_two_providers_both_survive(
        self, db_session: AsyncSession, test_user
    ):
        """Distinct providers are never interchangeable."""
        primary = await _route(db_session, test_user.id, "Keep", POLY_A)
        duplicate = await _route(db_session, test_user.id, "Drop", POLY_B)
        await _source(db_session, primary, test_user.id, "route_999")
        db_session.add(
            RouteSource(
                route_id=duplicate.id,
                user_id=test_user.id,
                provider="strava",
                provider_route_id="555",
                provider_name="Drop",
                encoded_polyline=POLY_B,
            )
        )
        await db_session.flush()

        await merge_routes(db_session, primary.id, duplicate.id, test_user.id)
        await db_session.commit()

        kept = await _sources_on(db_session, primary.id)
        assert sorted(kept) == ["555", "route_999"], (
            f"kept {kept}; a Strava source was lost in a Komoot merge"
        )
