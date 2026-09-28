"""B2: `estimated_tss` is derived from sets + bodyweight, and self-heals.

The metric was `duration_min × avg_RPE / 7`, which rated a 3×3 at 200 kg and a
3×3 at 40 kg identically — it never looked at the work done. It is now
bodyweight-normalised tonnage × session RPE (Foster).

What these tests pin down, against the database:

- ``latest_body_weight`` reads the most recent ``WeightLog`` for the user, which
  is the input that separates the volume formula from the fallback.
- ``backfill_lifting_tss(force=True)`` **recomputes sessions that already have a
  value**. That is the whole point: the old values were computed by a formula
  that no longer exists, so leaving them would leave the chart permanently wrong.
  The weekly aggregation therefore passes ``force=True``.
- A user with no weigh-in falls back to the duration estimate rather than
  losing the number.

The pure arithmetic is covered in ``tests/test_lifting.py``.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lifting import LiftingSession, LiftingSet
from app.models.user import User
from app.models.weight import WeightLog
from app.services.lifting import backfill_lifting_tss, latest_body_weight

_SESSION_DATE = date(2026, 9, 20)


async def _add_session(
    db: AsyncSession,
    user: User,
    sets: list[tuple[float, int, float]],
    *,
    tss: float | None = None,
    duration: int | None = 3600,
) -> LiftingSession:
    session = LiftingSession(
        user_id=user.id,
        session_date=_SESSION_DATE,
        program_name="B2 Test",
        duration_seconds=duration,
        estimated_tss=tss,
    )
    db.add(session)
    await db.flush()
    for i, (weight, reps, rpe) in enumerate(sets, start=1):
        db.add(
            LiftingSet(
                session_id=session.id,
                exercise_name="Back Squat",
                set_number=i,
                weight_kg=weight,
                reps=reps,
                rpe=rpe,
            )
        )
    await db.flush()
    return session


async def _add_weigh_in(
    db: AsyncSession, user: User, kg: float, *, days_ago: int = 0
) -> None:
    db.add(
        WeightLog(
            user_id=user.id,
            date=_SESSION_DATE - timedelta(days=days_ago),
            weight_kilogram=kg,
            source="manual",
        )
    )
    await db.flush()


@pytest.mark.asyncio
async def test_latest_body_weight_returns_none_without_a_weigh_in(
    db_session: AsyncSession, test_user: User
):
    assert await latest_body_weight(db_session, test_user.id) is None


@pytest.mark.asyncio
async def test_latest_body_weight_picks_the_most_recent_entry(
    db_session: AsyncSession, test_user: User
):
    await _add_weigh_in(db_session, test_user, 84.0, days_ago=30)
    await _add_weigh_in(db_session, test_user, 80.0, days_ago=1)
    await _add_weigh_in(db_session, test_user, 81.5, days_ago=90)
    assert await latest_body_weight(db_session, test_user.id) == 80.0


@pytest.mark.asyncio
async def test_force_recomputes_sessions_that_already_have_a_value(
    db_session: AsyncSession, test_user: User
):
    """The old formula's numbers are left behind by a force pass.

    A single 200 kg × 5 set is 1000 kg of tonnage; the old duration×RPE estimate
    for a 1-hour session at RPE 8 was 68.6 regardless of the weight.
    """
    await _add_weigh_in(db_session, test_user, 100.0)
    session = await _add_session(
        db_session, test_user, [(200.0, 5, 8.0)], tss=68.6  # pre-B2 value
    )
    session_id = session.id
    await db_session.commit()

    updated = await backfill_lifting_tss(db_session, test_user.id, force=True)
    assert updated == 1

    await db_session.refresh(session, ["sets"])
    # 1000/100 × 0.8 × 1.4
    assert session.estimated_tss == pytest.approx(11.2, abs=0.05)
    assert session.estimated_tss != 68.6
    assert session.id == session_id


@pytest.mark.asyncio
async def test_default_pass_skips_sessions_that_already_have_a_value(
    db_session: AsyncSession, test_user: User
):
    """Without force, the backfill stays a backfill."""
    await _add_weigh_in(db_session, test_user, 100.0)
    session = await _add_session(
        db_session, test_user, [(200.0, 5, 8.0)], tss=68.6
    )

    assert await backfill_lifting_tss(db_session, test_user.id) == 0
    await db_session.refresh(session, ["sets"])
    assert session.estimated_tss == 68.6


@pytest.mark.asyncio
async def test_force_does_not_touch_another_users_sessions(
    db_session: AsyncSession, test_user: User
):
    other = User(
        id=uuid.uuid4(),
        email=f"b2-other-{uuid.uuid4().hex[:8]}@example.com",
        name="B2 Other",
    )
    db_session.add(other)
    await db_session.flush()
    await _add_weigh_in(db_session, other, 100.0)
    other_session = await _add_session(
        db_session, other, [(200.0, 5, 8.0)], tss=68.6
    )

    assert await backfill_lifting_tss(db_session, test_user.id, force=True) == 0
    await db_session.refresh(other_session, ["sets"])
    assert other_session.estimated_tss == 68.6


@pytest.mark.asyncio
async def test_a_user_without_a_weigh_in_keeps_a_number(
    db_session: AsyncSession, test_user: User
):
    """No bodyweight on record: the weaker duration estimate beats no number."""
    session = await _add_session(db_session, test_user, [(200.0, 5, 8.0)], tss=None)

    assert await backfill_lifting_tss(db_session, test_user.id, force=True) == 1
    await db_session.refresh(session, ["sets"])
    assert session.estimated_tss == pytest.approx(68.6, abs=0.05)


@pytest.mark.asyncio
async def test_heavier_and_longer_sessions_sort_by_load(
    db_session: AsyncSession, test_user: User
):
    """End to end: the ordering the chart relies on actually changed."""
    await _add_weigh_in(db_session, test_user, 80.0)
    light = await _add_session(
        db_session, test_user, [(40.0, 5, 8.0)] * 3, tss=0.0
    )
    heavy = await _add_session(
        db_session, test_user, [(200.0, 5, 8.0)] * 3, tss=0.0
    )

    await backfill_lifting_tss(db_session, test_user.id, force=True)
    await db_session.refresh(light, ["sets"])
    await db_session.refresh(heavy, ["sets"])

    # 600 kg and 3000 kg of tonnage at the same RPE → 5x the load.
    assert light.estimated_tss is not None and heavy.estimated_tss is not None
    assert heavy.estimated_tss / light.estimated_tss == pytest.approx(5.0, rel=0.01)
