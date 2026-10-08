"""Integration tests for the RMI-08 ``CrossDomainInsight`` upsert fix.

RMI-08: the weekly scheduler (``analyze_cross_domain_weekly`` in
``app/tasks/scheduler.py``) used to blind-insert a fresh
``CrossDomainInsight`` row per ``insight_type`` every run for
``sleep_performance`` and ``cross_sport`` (one row per week, unbounded).
``race_retrospective`` was deduped per *event* via a Python lookup, not by a
DB constraint.

The fix (Task t2, captain-approved Option A) is three parts:
  1. a ``UniqueConstraint(user_id, insight_type)`` on the model
  2. migration 097 which dedups existing rows then adds that constraint
  3. a scheduler that upserts via ``pg_insert(...).on_conflict_do_update``
     keyed on ``(user_id, insight_type)`` instead of ``db.add()``

These tests pin that behaviour against a real PostgreSQL database.

Contract mapping (Task t3):
  (a) two weekly runs -> exactly one CrossDomainInsight per (user_id, type)
      -> test_two_weekly_runs_produce_one_row_per_type
      -> test_scheduler_task_run_twice_yields_one_row_per_type (end-to-end)
  (b) the unique constraint prevents duplicates
      -> test_unique_constraint_prevents_duplicates
  (c) existing data is preserved on upsert (row identity kept, payload refreshed)
      -> test_upsert_preserves_existing_row
  (d) regression guard: the scheduler upserts, does not blind ``db.add()``
      -> test_scheduler_uses_upsert_not_blind_insert

The upsert statements in the unit-style tests below are the *exact* construct
from ``app/tasks/scheduler.py`` (``analyze_cross_domain_weekly``, the
``pg_insert(CrossDomainInsight).on_conflict_do_update(...)`` block). They are
driven through the shared ``db_session`` fixture (transactional, rolled back on
teardown) so they are hermetic without a live Modal/Redis stack. The
end-to-end test instead calls the real Celery task with Modal mocked (see its
docstring for why it manages its own engine).
"""

from __future__ import annotations

import asyncio
import datetime as dt
import uuid

import pytest
from sqlalchemy import delete, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.database import Base
from app.models.activity import Activity
from app.models.cross_domain import CrossDomainInsight
from app.models.cycling import CyclingProfile
from app.models.sleep import SleepLog
from app.models.user import User
from tests.integration.conftest import TEST_DATABASE_URL

pytestmark = [pytest.mark.integration, pytest.mark.cheap]

# The three insight types the weekly scheduler stores (Option A: all share the
# (user_id, insight_type) uniqueness), matching scheduler.py's store loop.
_INSIGHT_TYPES = ["sleep_performance", "cross_sport", "race_retrospective"]


def _weekly_upsert(user_id, insight_type, insight_data, data_quality):
    """The identical upsert ``analyze_cross_domain_weekly`` issues per run.

    Copied verbatim from ``app/tasks/scheduler.py`` (the
    ``pg_insert(CrossDomainInsight).values(...).on_conflict_do_update(...)``
    block): same columns on insert AND on conflict, same
    ``index_elements=["user_id", "insight_type"]`` conflict target.
    """
    return (
        pg_insert(CrossDomainInsight)
        .values(
            user_id=user_id,
            insight_type=insight_type,
            results=insight_data,
            insights=insight_data.get("insights", []),
            data_quality=data_quality,
        )
        .on_conflict_do_update(
            index_elements=["user_id", "insight_type"],
            set_={
                "results": insight_data,
                "insights": insight_data.get("insights", []),
                "data_quality": data_quality,
            },
        )
    )


# ── (a) two weekly runs -> one row per (user_id, insight_type) ───────────────


async def test_two_weekly_runs_produce_one_row_per_type(db_session, test_user):
    """Two successive weekly runs upsert the same three types for one user.

    The second run must overwrite in place (ON CONFLICT DO UPDATE) rather than
    append a new row, so the unique constraint never fires and exactly one row
    survives per type.
    """
    uid = test_user.id
    run1 = {
        t: {
            "data_quality": {"sufficient": True},
            "insights": [f"{t}-run1"],
            "payload": 1,
        }
        for t in _INSIGHT_TYPES
    }
    run2 = {
        t: {
            "data_quality": {"sufficient": True},
            "insights": [f"{t}-run2"],
            "payload": 2,
        }
        for t in _INSIGHT_TYPES
    }

    # First weekly run.
    for t in _INSIGHT_TYPES:
        await db_session.execute(
            _weekly_upsert(uid, t, run1[t], run1[t]["data_quality"])
        )

    # Second weekly run, with a different payload.
    for t in _INSIGHT_TYPES:
        await db_session.execute(
            _weekly_upsert(uid, t, run2[t], run2[t]["data_quality"])
        )

    rows = (
        await db_session.execute(
            select(CrossDomainInsight)
            .where(CrossDomainInsight.user_id == uid)
            .order_by(CrossDomainInsight.insight_type)
        )
    ).scalars().all()

    # Exactly one row per insight type — no accumulation across runs.
    assert len(rows) == len(_INSIGHT_TYPES)
    assert {r.insight_type for r in rows} == set(_INSIGHT_TYPES)

    # The latest run wins: the second upsert's payload is what each row shows.
    by_type = {r.insight_type: r for r in rows}
    for t in _INSIGHT_TYPES:
        assert by_type[t].results == run2[t], (
            f"{t} row was not overwritten by the second weekly run"
        )


async def test_two_runs_same_user_two_types_are_all_distinct(db_session, test_user):
    """The dedup key is (user_id, insight_type): the same type is collapsed,
    but different types for the same user are independent rows."""
    uid = test_user.id
    await db_session.execute(
        _weekly_upsert(
            uid,
            "sleep_performance",
            {"insights": ["sp"], "data_quality": {"sufficient": True}},
            {"sufficient": True},
        )
    )
    await db_session.execute(
        _weekly_upsert(
            uid,
            "cross_sport",
            {"insights": ["cs"], "data_quality": {"sufficient": True}},
            {"sufficient": True},
        )
    )
    # Two runs each.
    await db_session.execute(
        _weekly_upsert(
            uid,
            "sleep_performance",
            {"insights": ["sp2"], "data_quality": {"sufficient": True}},
            {"sufficient": True},
        )
    )
    await db_session.execute(
        _weekly_upsert(
            uid,
            "cross_sport",
            {"insights": ["cs2"], "data_quality": {"sufficient": True}},
            {"sufficient": True},
        )
    )

    rows = (
        await db_session.execute(
            select(CrossDomainInsight).where(CrossDomainInsight.user_id == uid)
        )
    ).scalars().all()
    assert len(rows) == 2
    assert {r.insight_type for r in rows} == {"sleep_performance", "cross_sport"}


# ── (b) the unique constraint prevents duplicates ───────────────────────────


async def test_unique_constraint_prevents_duplicates(db_session, test_user):
    """A blind insert of a second (user_id, insight_type) row is rejected by the
    DB-level UniqueConstraint (``uq_cross_domain_insight_user_type``)."""
    uid = test_user.id
    payload = {
        "user_id": uid,
        "insight_type": "sleep_performance",
        "results": {"insights": ["first"]},
    }
    # First row: fine.
    await db_session.execute(
        insert(CrossDomainInsight).values(id=uuid.uuid4(), **payload)
    )
    # Second row, same (user_id, insight_type), different id: must be refused.
    with pytest.raises(IntegrityError) as exc_info:
        await db_session.execute(
            insert(CrossDomainInsight).values(id=uuid.uuid4(), **payload)
        )
    # The violation targets exactly the (user_id, insight_type) constraint.
    assert "uq_cross_domain_insight_user_type" in str(exc_info.value.orig)
    # Reset the aborted transaction so the fixture teardown can roll back cleanly.
    await db_session.rollback()


async def test_constraint_exists_on_model_and_metadata():
    """Sanity: the constraint that (b) relies on is the one the model declares,
    so the upsert's ON CONFLICT target is real and matches the migration."""
    from sqlalchemy import UniqueConstraint

    ucs = [
        c
        for c in CrossDomainInsight.__table__.constraints
        if isinstance(c, UniqueConstraint)
    ]
    assert len(ucs) == 1, f"expected exactly one UniqueConstraint, got {ucs}"
    assert ucs[0].name == "uq_cross_domain_insight_user_type"
    assert {c.name for c in ucs[0].columns} == {"user_id", "insight_type"}


# ── (c) existing data is preserved on upsert ─────────────────────────────────


async def test_upsert_preserves_existing_row_identity(db_session, test_user):
    """An upsert overwrites the payload in place: the row's identity (id) is
    preserved and its content is refreshed to the latest run's data."""
    uid = test_user.id
    # Pre-existing row, as if a previous weekly run stored it.
    existing = CrossDomainInsight(
        user_id=uid,
        insight_type="cross_sport",
        results={"insights": ["old"], "payload": 1},
        insights=["old"],
        data_quality={"sufficient": True},
    )
    db_session.add(existing)
    await db_session.flush()
    original_id = existing.id

    # Simulate a subsequent weekly run upserting over the existing row.
    refreshed = {
        "insights": ["new"],
        "payload": 2,
        "data_quality": {"sufficient": True},
    }
    await db_session.execute(
        _weekly_upsert(
            uid,
            "cross_sport",
            refreshed,
            refreshed["data_quality"],
        )
    )

    # The upsert is a Core INSERT..ON CONFLICT, so refresh the ORM instance so
    # it reflects the DB-side UPDATE rather than the in-memory value from flush().
    await db_session.refresh(existing)
    updated = existing
    assert updated is not None
    assert updated.id == original_id  # same row, not a new one
    assert updated.results == refreshed  # payload refreshed to latest run
    assert updated.insights == ["new"]


async def test_upsert_fills_a_missing_row(db_session, test_user):
    """The ON CONFLICT path also INSERTs when no row exists yet (first run)."""
    uid = test_user.id
    await db_session.execute(
        _weekly_upsert(
            uid,
            "race_retrospective",
            {"insights": ["first-retro"], "vs_projection": {"gap": 5.0}},
            {},
        )
    )
    rows = (
        await db_session.execute(
            select(CrossDomainInsight).where(
                CrossDomainInsight.user_id == uid,
                CrossDomainInsight.insight_type == "race_retrospective",
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].results["insights"] == ["first-retro"]


# ── (d) regression guard: scheduler upserts, does not blind db.add() ──────────


def test_scheduler_uses_upsert_not_blind_insert():
    """Guard against the RMI-08 bug regressing: the weekly store must use the
    PostgreSQL ``ON CONFLICT DO UPDATE`` upsert keyed on ``(user_id,
    insight_type)``, not a blind ``db.add(insight)`` that appends a new row."""
    import pathlib

    import app.tasks.scheduler as sched

    src = pathlib.Path(sched.__file__).read_text(encoding="utf-8")

    # The upsert construct the weekly task relies on.
    assert "pg_insert(CrossDomainInsight)" in src
    assert "on_conflict_do_update" in src
    assert '"user_id", "insight_type"' in src  # the conflict target

    # The blind-insert bug must be gone from the weekly analysis store.
    # (Other tasks in scheduler.py still use db.add for unrelated models; only
    # the CrossDomainInsight insert is in scope here, by the variable name used.)
    assert "db.add(insight)" not in src


# ── (a) end-to-end: the real weekly task, run twice (Modal mocked) ─────────────


def test_scheduler_task_run_twice_yields_one_row_per_type(monkeypatch):
    """End-to-end: invoke the real ``analyze_cross_domain_weekly`` Celery task
    twice — with Modal mocked out — and assert it stores exactly one
    CrossDomainInsight per (user_id, insight_type).

    This closes the test gap flagged in the t1 audit: no test exercised the
    weekly scheduler's storage path end-to-end. It cannot reuse the async
    ``db_session`` fixture because the task wrapper calls ``asyncio.run()``
    (colliding with the pytest-asyncio session loop) and opens its own
    ``task_session()`` connection, so it is fully self-contained: a dedicated
    engine (fresh per ``asyncio.run`` so asyncpg's loop-bound connections do
    not collide — see pitfall #1), a throwaway user_id (isolated from the
    random-uuid transactional tests), and explicit teardown of its own rows.

    Modal is mocked so the test needs no Modal credentials/network; the Redis
    concurrency lock is bypassed via ``_run_task_guarded`` so no broker is
    required (pitfall #23: tests run host-side).
    """
    from app.tasks.scheduler import analyze_cross_domain_weekly

    uid = uuid.uuid4()

    class _FakeBreaker:
        """ModalCircuitBreaker stand-in that never trips."""

        def allow(self, name: str) -> bool:
            return True

        def record(self, name: str, success: bool) -> None:
            return None

    def _fake_modal(
        *, sleep_data, performance_data, lifting_data, cycling_data, recovery_data, **kwargs
    ):
        """Return sufficient data for all three insight types."""
        return {
            "sleep_performance": {
                "data_quality": {"sufficient": True},
                "insights": ["sleep insight"],
                "correlations": {"hrv_ms": {"r_squared": 0.8, "n_points": 20}},
            },
            "cross_sport": {
                "data_quality": {"sufficient": True},
                "insights": ["cross-sport insight"],
                "correlations": {
                    "fatigue_slope": {"slope": -0.1, "r_squared": 0.6, "n_points": 15}
                },
            },
            "race_retrospective": {
                "insights": ["retrospective insight"],
                "vs_projection": {"gap": 5.0},
            },
        }

    async def _no_lock(_task_name: str, _run) -> dict:
        # Bypass the Redis lock; just run the task body.
        return await _run()

    # Patch: the DB URL task_session() will use, the lock guard, the circuit
    # breaker, and the Modal boundary.
    import app.database as database_mod
    import app.integrations.cross_domain as cd_mod
    import app.tasks.scheduler as scheduler_mod

    monkeypatch.setattr(database_mod.settings, "database_url", TEST_DATABASE_URL)
    monkeypatch.setattr(scheduler_mod, "_run_task_guarded", _no_lock)
    monkeypatch.setattr(scheduler_mod, "_MODAL_BREAKER", _FakeBreaker())
    monkeypatch.setattr(cd_mod, "_modal_configured", lambda: True)
    monkeypatch.setattr(cd_mod, "analyze_cross_domain_on_modal", _fake_modal)

    async def _setup() -> None:
        # Fresh engine per event loop: asyncpg connections bind to a loop, and
        # this helper runs in its own asyncio.run() distinct from the task's.
        eng = create_async_engine(TEST_DATABASE_URL)
        try:
            async with eng.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            # Committed setup so the task's own task_session() (separate conn)
            # can see the user's data.
            async with AsyncSession(eng) as s:
                s.add(User(id=uid, email=f"e2e-{uid}@example.com", name="E2E User"))
                s.add(
                    CyclingProfile(user_id=uid, ftp_watts=250.0, weight_kg=75.0)
                )
                now = dt.datetime.now(dt.UTC)
                base = now - dt.timedelta(days=60)
                for i in range(20):
                    day = dt.date.today() - dt.timedelta(days=i)
                    s.add(
                        SleepLog(
                            user_id=uid,
                            sleep_date=day,
                            source="whoop",
                            total_sleep_seconds=28800,
                            deep_sleep_seconds=5400,
                            rem_sleep_seconds=7200,
                            light_sleep_seconds=16200,
                            sleep_efficiency=92.0,
                            created_at=base + dt.timedelta(days=i),
                        )
                    )
                for i in range(20):
                    s.add(
                        Activity(
                            user_id=uid,
                            source="strava",
                            sport_type="cycling",
                            name=f"Ride {i}",
                            start_date=now - dt.timedelta(days=i),
                            duration_seconds=3600,
                            distance_meters=40_000.0,
                            average_power=200.0,
                            normalized_power=210.0,
                            tss=80.0,
                            calories=600.0,
                            provider_activity_id=f"e2e_{i}",
                            created_at=base + dt.timedelta(days=i),
                        )
                    )
                await s.commit()
        finally:
            await eng.dispose()

    async def _verify() -> tuple[int, set[str]]:
        eng = create_async_engine(TEST_DATABASE_URL)
        try:
            async with AsyncSession(eng) as s:
                rows = (
                    await s.execute(
                        select(CrossDomainInsight)
                        .where(CrossDomainInsight.user_id == uid)
                        .order_by(CrossDomainInsight.insight_type)
                    )
                ).scalars().all()
                return len(rows), {r.insight_type for r in rows}
        finally:
            await eng.dispose()

    async def _cleanup() -> None:
        eng = create_async_engine(TEST_DATABASE_URL)
        try:
            async with AsyncSession(eng) as s:
                await s.execute(
                    delete(CrossDomainInsight).where(
                        CrossDomainInsight.user_id == uid
                    )
                )
                await s.execute(delete(Activity).where(Activity.user_id == uid))
                await s.execute(delete(SleepLog).where(SleepLog.user_id == uid))
                await s.execute(
                    delete(CyclingProfile).where(CyclingProfile.user_id == uid)
                )
                await s.execute(delete(User).where(User.id == uid))
                await s.commit()
        finally:
            await eng.dispose()

    try:
        asyncio.run(_setup())

        first = analyze_cross_domain_weekly()
        second = analyze_cross_domain_weekly()

        assert first["users_analyzed"] == 1, first
        assert second["users_analyzed"] == 1, second
        assert first["errors"] == [] and second["errors"] == [], (first, second)

        count, types = asyncio.run(_verify())

        # Two weekly runs must yield exactly one row per (user_id, insight_type).
        assert count == 3, f"expected 3 rows (one per type), got {count}"
        assert types == {
            "sleep_performance",
            "cross_sport",
            "race_retrospective",
        }
    finally:
        asyncio.run(_cleanup())
