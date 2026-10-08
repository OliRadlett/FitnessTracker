"""Integration tests for the weather threshold alignment (t1 → t3).

t1 diagnosis: the scheduler dispatched Modal with >=15 eligible rides, but
the worker only persists when ``total >= 20 and with_weather >= 15`` — prod's
17-ride sample paid for a Modal call every Sunday whose result was silently
discarded, so ``weather_analyzed_at`` stayed NULL forever.

The fix pins both sides to one shared gate
(``is_weather_sample_sufficient`` in ``app/integrations/weather_analysis.py``),
logs both discard paths, and backfills pre-30-day untagged rides weekly.

These tests pin that behaviour against a real PostgreSQL database:

  (a) 17 tagged rides -> pre-gate skip: no Modal call, ``weather_analyzed_at``
      stays NULL, ``users_skipped_insufficient == 1``
  (b) 22 tagged rides -> Modal runs (truthful local analysis, not a canned
      payload), results persist, ``weather_analyzed_at`` is set

Follows the ``test_cross_domain_upsert.py`` end-to-end pattern: the real
Celery task with a mocked Modal boundary, its own engine per ``asyncio.run``
(pitfall #1), a throwaway user_id, explicit teardown, and the Redis lock
bypassed via ``_run_task_guarded``. The history backfill is stubbed to 0 so
the test needs no Open-Meteo network; its query window is covered by the
pure unit tests.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import uuid

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.database import Base
from app.models.activity import Activity
from app.models.cycling import CyclingProfile
from app.models.user import User
from tests.integration.conftest import TEST_DATABASE_URL

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


def _run_weekly_task(n_rides: int):
    """Set up one user with ``n_rides`` tagged rides, run the real weekly
    task with Modal mocked, and return (result, modal_calls, analyzed_at)."""
    from app.tasks.scheduler import analyze_weather_performance_weekly

    uid = uuid.uuid4()
    modal_calls: list[int] = []

    class _FakeBreaker:
        def allow(self, name: str) -> bool:
            return True

        def record(self, name: str, success: bool) -> None:
            return None

    def _fake_modal(rides, route_headings=None):
        """Truthful stand-in: run the REAL worker analysis locally so the
        test exercises the true persist gate, not a canned payload."""
        from app.integrations.weather_analysis import analyze_weather_performance

        modal_calls.append(len(rides))
        return analyze_weather_performance(rides, route_headings)

    async def _no_lock(_task_name: str, _run) -> dict:
        return await _run()

    async def _noop_backfill(_db, _user_id, **_kwargs) -> int:
        return 0

    import app.database as database_mod
    import app.integrations.weather_analysis as weather_mod
    import app.services.weather as weather_svc_mod
    import app.tasks.scheduler as scheduler_mod

    async def _setup() -> None:
        eng = create_async_engine(TEST_DATABASE_URL)
        try:
            async with eng.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            async with AsyncSession(eng) as s:
                s.add(User(id=uid, email=f"wthr-{uid}@example.com", name="Wthr User"))
                s.add(
                    CyclingProfile(user_id=uid, ftp_watts=250.0, weight_kg=75.0)
                )
                now = dt.datetime.now(dt.UTC)
                for i in range(n_rides):
                    s.add(
                        Activity(
                            user_id=uid,
                            source="strava",
                            sport_type="cycling",
                            name=f"Ride {i}",
                            start_date=now - dt.timedelta(days=i * 3),
                            duration_seconds=3600,
                            distance_meters=40_000.0,
                            average_power=200.0 + (i % 5) * 5,
                            normalized_power=210.0,
                            weather_temperature=12.0 + (i % 10),
                            weather_wind_speed_kmh=10.0,
                            provider_activity_id=f"wthr_{uid.hex}_{i}",
                        )
                    )
                await s.commit()
        finally:
            await eng.dispose()

    async def _analyzed_at():
        eng = create_async_engine(TEST_DATABASE_URL)
        try:
            async with AsyncSession(eng) as s:
                profile = (
                    await s.execute(
                        select(CyclingProfile).where(
                            CyclingProfile.user_id == uid
                        )
                    )
                ).scalar_one()
                return profile.weather_analyzed_at
        finally:
            await eng.dispose()

    async def _cleanup() -> None:
        eng = create_async_engine(TEST_DATABASE_URL)
        try:
            async with AsyncSession(eng) as s:
                await s.execute(delete(Activity).where(Activity.user_id == uid))
                await s.execute(
                    delete(CyclingProfile).where(CyclingProfile.user_id == uid)
                )
                await s.execute(delete(User).where(User.id == uid))
                await s.commit()
        finally:
            await eng.dispose()

    # Patch paths the task resolves lazily at call time (``from ... import``
    # inside ``_run`` / the backfill ``try``), so module-attr patching lands.
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(database_mod.settings, "database_url", TEST_DATABASE_URL)
        mp.setattr(scheduler_mod, "_run_task_guarded", _no_lock)
        mp.setattr(scheduler_mod, "_MODAL_BREAKER", _FakeBreaker())
        mp.setattr(weather_mod, "_modal_configured", lambda: True)
        mp.setattr(weather_mod, "analyze_weather_on_modal", _fake_modal)
        mp.setattr(weather_svc_mod, "tag_untagged_history", _noop_backfill)
        try:
            asyncio.run(_setup())
            result = analyze_weather_performance_weekly()
            analyzed_at = asyncio.run(_analyzed_at())
        finally:
            asyncio.run(_cleanup())
    return result, modal_calls, analyzed_at


def test_seventeen_rides_skips_modal_and_persists_nothing():
    """The prod scenario: 17 eligible rides used to dispatch Modal and then
    silently discard the insufficient result. Now the shared pre-gate skips
    before any Modal call, observably."""
    result, modal_calls, analyzed_at = _run_weekly_task(17)
    assert modal_calls == [], modal_calls
    assert result["users_analyzed"] == 0, result
    assert result["users_skipped_insufficient"] == 1, result
    assert result["errors"] == [], result
    assert analyzed_at is None


def test_twenty_two_rides_analyzes_and_persists():
    """At/above the shared gate the truthful analysis persists and stamps
    ``weather_analyzed_at``."""
    result, modal_calls, analyzed_at = _run_weekly_task(22)
    assert modal_calls == [22], modal_calls
    assert result["users_analyzed"] == 1, result
    assert result["users_skipped_insufficient"] == 0, result
    assert result["errors"] == [], result
    assert analyzed_at is not None
