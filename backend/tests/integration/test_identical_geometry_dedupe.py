"""A byte-identical polyline is proof of the same route, not a similarity score.

Twelve Komoot tours ended up stored twice. The mechanism took two independent
defects to line up:

1. ``find_duplicate_route`` filters on ``active_routes_clause()``, so a
   quarantined route is invisible to geometric dedupe. That filter arrived
   with the quarantine feature itself (``b18ba3e``) — the feature meant to set
   a route aside is what made it duplicable.
2. Komoot tours were ingested under two spellings of one id (``3258675512``
   and ``route_3258675512``), so the exact-source lookup missed too.

A quarantined route was then invisible to *both* lookups, and the next sync
recreated it from scratch. Nine of the twelve duplicates were created in a
single 18:00 sync. In eight of the twelve the live row is the newer one —
i.e. the user had merged or quarantined the original and sync put it back.

So the check has to be able to see quarantined rows. That is a real loosening
of ``create_or_merge_route``, which otherwise only merges or creates, and it
was taken deliberately: byte equality is a categorical signal, not a
tuned threshold, so it cannot be moved by recalibration and cannot fire on a
route that merely resembles another.

The false-positive surface is a sub-section of a longer route, which is
exactly the case that would poison route training. ``test_a_subsection_is_not_
byte_identical`` exists to keep that honest.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.route import Route, RouteSource
from app.services.route_service import create_or_merge_route

pytestmark = pytest.mark.asyncio

# Two spellings of one Komoot id — the shape that produced the twins.
BARE = "3258675512"
PREFIXED = "route_3258675512"

POLYLINE = "o}~mH~}xMz@z@z@z@z@z@"


def _short_polyline() -> str:
    """A shorter ride from the same start — a sub-section, byte-wise distinct.

    Built with the app's own encoder so it is guaranteed decodable, rather
    than a hand-written string that might not survive varint decoding.
    """
    from app.services.polyline_utils import encode_polyline

    return encode_polyline(
        [(56.0 + i * 1e-4, -3.5) for i in range(40)],
    )


async def _route(
    db: AsyncSession, user_id, *, polyline: str = POLYLINE, distance: float = 15000.0
) -> Route:
    route = Route(
        user_id=user_id,
        name="Ben Cleuch & the Ochil Hills",
        sport_type="cycling",
        distance_meters=distance,
        encoded_polyline=polyline,
        start_lat=56.0,
        start_lng=-3.5,
        end_lat=56.0,
        end_lng=-3.5,
        is_loop=True,
    )
    db.add(route)
    await db.flush()
    return route


async def _source(db: AsyncSession, route: Route, user_id, provider_route_id: str):
    db.add(
        RouteSource(
            route_id=route.id,
            user_id=user_id,
            provider="komoot",
            provider_route_id=provider_route_id,
            provider_name="Ben Cleuch & the Ochil Hills",
            encoded_polyline=POLYLINE,
        )
    )
    await db.flush()


class TestAQuarantinedTwinIsFound:
    """The regression guard for the whole class — fails on current code."""

    async def test_quarantined_identical_route_absorbs_the_source(
        self, db_session: AsyncSession, test_user
    ):
        import datetime

        existing = await _route(db_session, test_user.id)
        await _source(db_session, existing, test_user.id, PREFIXED)
        existing.quarantined_at = datetime.datetime.now(datetime.UTC)
        await db_session.flush()

        result = await create_or_merge_route(
            db_session,
            test_user.id,
            name="Ben Cleuch & the Ochil Hills",
            sport_type="cycling",
            distance_meters=15000.0,
            encoded_polyline=POLYLINE,
            provider="komoot",
            provider_route_id=BARE,
            provider_name="Ben Cleuch & the Ochil Hills",
        )
        await db_session.flush()

        assert result.id == existing.id, (
            "sync recreated a route it already had, byte for byte. The twin "
            "was quarantined, so dedupe could not see it."
        )
        sources = list(
            (
                await db_session.execute(
                    select(RouteSource).where(RouteSource.route_id == existing.id)
                )
            )
            .scalars()
            .all()
        )
        # add_route_source skips when the provider already has a source on the
        # route, so the second spelling is dropped rather than stored twice.
        # That is fine, and is the point: one row for the tour. What must not
        # happen is a second row, so assert the invariant directly.
        assert {s.provider_route_id for s in sources} <= {PREFIXED, BARE}
        rows = list(
            (
                await db_session.execute(
                    select(Route).where(
                        Route.user_id == test_user.id,
                        Route.encoded_polyline == POLYLINE,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1, (
            f"the tour is stored on {len(rows)} routes; sync is recreating "
            "duplicates that a merge already resolved"
        )

    async def test_re_syncing_does_not_regrow_a_merged_twin(
        self, db_session: AsyncSession, test_user
    ):
        """The test that would have caught the nine-per-sync regrowth.

        Merge the twin, then sync again. Before the fix the second sync saw a
        quarantined route it could not match and created a fresh row — which
        is why merges did not hold.
        """
        import datetime

        existing = await _route(db_session, test_user.id)
        await _source(db_session, existing, test_user.id, PREFIXED)
        existing.quarantined_at = datetime.datetime.now(datetime.UTC)
        await db_session.flush()

        for spelling in (BARE, BARE, BARE):
            await create_or_merge_route(
                db_session,
                test_user.id,
                name="Ben Cleuch & the Ochil Hills",
                sport_type="cycling",
                distance_meters=15000.0,
                encoded_polyline=POLYLINE,
                provider="komoot",
                provider_route_id=spelling,
                provider_name="Ben Cleuch & the Ochil Hills",
            )
            await db_session.flush()

        rows = list(
            (
                await db_session.execute(
                    select(Route).where(
                        Route.user_id == test_user.id,
                        Route.encoded_polyline == POLYLINE,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1, (
            f"three re-syncs produced {len(rows)} routes; each sync recreates "
            "the twin, so merging it is futile"
        )

    async def test_quarantine_is_not_lifted_by_absorption(
        self, db_session: AsyncSession, test_user
    ):
        """Absorbing a twin must not silently resurrect a user's decision."""
        import datetime

        existing = await _route(db_session, test_user.id)
        await _source(db_session, existing, test_user.id, PREFIXED)
        stamp = datetime.datetime.now(datetime.UTC)
        existing.quarantined_at = stamp
        await db_session.flush()

        result = await create_or_merge_route(
            db_session,
            test_user.id,
            name="Ben Cleuch & the Ochil Hills",
            sport_type="cycling",
            distance_meters=15000.0,
            encoded_polyline=POLYLINE,
            provider="komoot",
            provider_route_id=BARE,
            provider_name="Ben Cleuch & the Ochil Hills",
        )
        await db_session.refresh(result)

        assert result.quarantined_at is not None
        assert result.quarantined_at == stamp, "quarantine was cleared by sync"


class TestTheCheckCannotFireOnADifferentRoute:
    async def test_a_subsection_is_not_absorbed(
        self, db_session: AsyncSession, test_user
    ):
        """The false-positive guard.

        A short out-and-back sharing a start point with a much longer route is
        the shape that would poison route training if this check were fuzzy.
        Byte equality cannot match it, and neither may the guard.
        """
        long_route = await _route(db_session, test_user.id, distance=40000.0)
        await _source(db_session, long_route, test_user.id, PREFIXED)

        shorter = _short_polyline()
        assert shorter != POLYLINE, "fixture must differ byte-wise"

        result = await create_or_merge_route(
            db_session,
            test_user.id,
            name="Ben Cleuch & the Ochil Hills",
            sport_type="cycling",
            distance_meters=4000.0,
            encoded_polyline=shorter,
            provider="komoot",
            provider_route_id=BARE,
            provider_name="Ben Cleuch & the Ochil Hills",
        )
        await db_session.flush()

        assert result.id != long_route.id, (
            "a sub-section was absorbed into a longer route — this is the "
            "false positive that would poison training data"
        )

    async def test_same_geometry_different_distance_is_not_absorbed(
        self, db_session: AsyncSession, test_user
    ):
        """A different distance means a different ride, not a re-resolution."""
        existing = await _route(db_session, test_user.id, distance=15000.0)
        await _source(db_session, existing, test_user.id, PREFIXED)

        result = await create_or_merge_route(
            db_session,
            test_user.id,
            name="Ben Cleuch & the Ochil Hills",
            sport_type="cycling",
            distance_meters=15001.0,
            encoded_polyline=POLYLINE,
            provider="komoot",
            provider_route_id=BARE,
            provider_name="Ben Cleuch & the Ochil Hills",
        )
        await db_session.flush()

        assert result.id != existing.id

    async def test_geometry_is_user_scoped(
        self, db_session: AsyncSession, test_user, test_cycling_profile
    ):
        """Two users recording the same ride must not collapse into one row."""
        import uuid

        from app.models.user import User

        other = User(
            email=f"other-{uuid.uuid4().hex[:8]}@example.com",
            name="Other Rider",
        )
        db_session.add(other)
        await db_session.flush()

        mine = await _route(db_session, test_user.id)
        await _source(db_session, mine, test_user.id, PREFIXED)
        theirs = await _route(db_session, other.id)
        await _source(db_session, theirs, other.id, PREFIXED)

        result = await create_or_merge_route(
            db_session,
            other.id,
            name="Ben Cleuch & the Ochil Hills",
            sport_type="cycling",
            distance_meters=15000.0,
            encoded_polyline=POLYLINE,
            provider="komoot",
            provider_route_id=BARE,
            provider_name="Ben Cleuch & the Ochil Hills",
        )
        await db_session.flush()

        # The safety property, which must hold before and after the change.
        assert result.id != mine.id, (
            "create_or_merge_route returned another user's route — identical "
            "geometry must not cross the user boundary"
        )
        # The new behaviour: the other user's own identical route is found.
        assert result.id == theirs.id, (
            "the user's own byte-identical route was not reused, so their data "
            "is duplicated instead of merged"
        )
