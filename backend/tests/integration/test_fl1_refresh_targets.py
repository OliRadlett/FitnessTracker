"""Integration tests for FL1 load-coherence propagation (backend).

Covers: POST /training-plans/{id}/refresh-targets (stale-day rewrite +
CP/FTP mismatch + strength skip), the week-view ``targets_stale`` flag, and
``training_load_for_user`` tau fallback/selection.

Run with: pytest tests/integration/test_fl1_refresh_targets.py -m integration
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


async def _make_profile(db_session, test_user, **overrides):
    from app.models.cycling import CyclingProfile

    fields = {
        "user_id": test_user.id,
        "ftp_watts": 250.0,
        "weight_kg": 75.0,
        "lactate_threshold_hr": 170.0,
    }
    fields.update(overrides)
    profile = CyclingProfile(**fields)
    db_session.add(profile)
    await db_session.flush()
    return profile


async def _make_plan(db_session, test_user, days: list[dict]):
    from app.models.training_plan import TrainingPlan, TrainingPlanDay

    plan = TrainingPlan(
        user_id=test_user.id,
        name="FL1 Plan",
        start_date=date.today() - timedelta(days=1),
        end_date=date.today() + timedelta(weeks=4),
        plan_type="custom",
        status="active",
    )
    db_session.add(plan)
    await db_session.flush()
    for d in days:
        db_session.add(TrainingPlanDay(plan_id=plan.id, **d))
    await db_session.flush()
    await db_session.refresh(plan, ["days"])
    return plan


# At FTP 250, moderate (z3) × 60 min → power_low 188 W, tss_low 56.2.
# The "stale" values below are the same workout filled at FTP 200.
FRESH_POWER = 188
FRESH_TSS = 56.2
STALE_POWER = 150  # 200 × 0.75


class TestRefreshTargets:
    async def test_refresh_updates_stale_day_and_reports_mismatch(
        self, client, test_user, db_session
    ):
        """Stale upcoming cycle day is rewritten; CP mismatch + skip counted."""
        await _make_profile(db_session, test_user, critical_power=300.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": date.today() + timedelta(days=1),
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "planned_duration_min": 60,
                    "planned_power_watts": STALE_POWER,
                    "planned_tss": FRESH_TSS,
                },
                {
                    # Already fresh → reported unchanged, not rewritten.
                    "day_date": date.today() + timedelta(days=2),
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "planned_duration_min": 60,
                    "planned_power_watts": FRESH_POWER,
                    "planned_tss": FRESH_TSS,
                },
                {
                    # Strength day → skipped for FL3.
                    "day_date": date.today() + timedelta(days=3),
                    "sport": "strength",
                    "planned_type": "moderate",
                },
                {
                    # Completed stale day → never touched.
                    "day_date": date.today() + timedelta(days=4),
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "planned_duration_min": 60,
                    "planned_power_watts": STALE_POWER,
                    "planned_tss": FRESH_TSS,
                    "completed": True,
                },
                {
                    # Past stale day → never touched.
                    "day_date": date.today() - timedelta(days=1),
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "planned_duration_min": 60,
                    "planned_power_watts": STALE_POWER,
                    "planned_tss": FRESH_TSS,
                },
            ],
        )
        stale_id = next(
            d.id for d in plan.days if d.day_date == date.today() + timedelta(days=1)
        )
        fresh_id = next(
            d.id for d in plan.days if d.day_date == date.today() + timedelta(days=2)
        )

        resp = await client.post(f"/api/v1/training-plans/{plan.id}/refresh-targets")
        assert resp.status_code == 200
        data = resp.json()

        assert len(data["refreshed"]) == 1
        entry = data["refreshed"][0]
        assert entry["day_id"] == str(stale_id)
        assert entry["old_power"] == pytest.approx(STALE_POWER)
        assert entry["new_power"] == pytest.approx(FRESH_POWER)
        assert entry["old_tss"] == pytest.approx(FRESH_TSS)
        assert entry["new_tss"] == pytest.approx(FRESH_TSS)

        assert data["stale_but_unchanged"] == [str(fresh_id)]
        assert data["strength_days_skipped"] == 1

        mismatch = data["cp_ftp_mismatch"]
        assert mismatch is not None
        assert mismatch["ftp"] == pytest.approx(250.0)
        assert mismatch["critical_power"] == pytest.approx(300.0)
        assert mismatch["pct_diff"] == pytest.approx(20.0)

        # Persisted: stale day re-anchored, completed + past days untouched.
        from sqlalchemy import select

        from app.models.training_plan import TrainingPlanDay

        rows = (
            (
                await db_session.execute(
                    select(TrainingPlanDay).where(TrainingPlanDay.plan_id == plan.id)
                )
            )
            .scalars()
            .all()
        )
        by_date = {r.day_date: r for r in rows}
        assert by_date[
            date.today() + timedelta(days=1)
        ].planned_power_watts == pytest.approx(FRESH_POWER)
        assert by_date[
            date.today() + timedelta(days=4)
        ].planned_power_watts == pytest.approx(STALE_POWER)
        assert by_date[
            date.today() - timedelta(days=1)
        ].planned_power_watts == pytest.approx(STALE_POWER)

    async def test_refresh_no_mismatch_when_cp_close(
        self, client, test_user, db_session
    ):
        """CP within 10% of FTP → cp_ftp_mismatch is None."""
        await _make_profile(db_session, test_user, critical_power=260.0)  # +4%
        plan = await _make_plan(db_session, test_user, [])
        resp = await client.post(f"/api/v1/training-plans/{plan.id}/refresh-targets")
        assert resp.status_code == 200
        assert resp.json()["cp_ftp_mismatch"] is None

    async def test_refresh_unknown_plan_returns_404(self, client):
        import uuid

        resp = await client.post(
            f"/api/v1/training-plans/{uuid.uuid4()}/refresh-targets"
        )
        assert resp.status_code == 404


class TestWeekViewStaleness:
    async def test_week_view_carries_targets_stale(self, client, test_user, db_session):
        """Upcoming stale cycle day flags True; fresh/completed/strength do not."""
        await _make_profile(db_session, test_user)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": date.today() + timedelta(days=1),
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "planned_duration_min": 60,
                    "planned_power_watts": STALE_POWER,
                    "planned_tss": FRESH_TSS,
                },
                {
                    "day_date": date.today() + timedelta(days=2),
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "planned_duration_min": 60,
                    "planned_power_watts": FRESH_POWER,
                    "planned_tss": FRESH_TSS,
                },
            ],
        )

        resp = await client.get(
            f"/api/v1/training-plans/{plan.id}/week/1?include_weather=false"
        )
        assert resp.status_code == 200
        days = {d["day_date"]: d for d in resp.json()["days"]}
        # The +1/+2-day targets can straddle a week boundary (e.g. today is
        # Saturday) — pull week 2 as well and merge.
        resp2 = await client.get(
            f"/api/v1/training-plans/{plan.id}/week/2?include_weather=false"
        )
        assert resp2.status_code == 200
        days.update({d["day_date"]: d for d in resp2.json()["days"]})
        stale = days[(date.today() + timedelta(days=1)).isoformat()]
        fresh = days[(date.today() + timedelta(days=2)).isoformat()]
        assert stale["targets_stale"] is True
        assert fresh["targets_stale"] is False


class TestTrainingLoadForUser:
    async def _seed_tss(self, db_session, test_user):
        from app.models.activity import Activity

        db_session.add(
            Activity(
                user_id=test_user.id,
                source="strava",
                sport_type="cycling",
                name="Hard Ride",
                start_date=datetime.now(UTC) - timedelta(days=1),
                duration_seconds=3600,
                tss=120.0,
                provider_activity_id="strava_fl1_1",
            )
        )
        await db_session.flush()

    async def test_falls_back_to_constants_when_taus_unset(self, test_user, db_session):
        """No fitted taus → identical to canonical compute_training_load."""
        from app.services.cycling import compute_training_load
        from app.services.cycling.training_load import (
            CTL_WARMUP_DAYS,
            training_load_for_user,
        )
        from app.services.cycling.tss import get_daily_tss

        await _make_profile(db_session, test_user)
        await self._seed_tss(db_session, test_user)

        end = date.today()
        got = await training_load_for_user(
            db_session, test_user.id, end, lookback_days=7
        )
        daily = await get_daily_tss(
            db_session, test_user.id, end - timedelta(days=7 + CTL_WARMUP_DAYS), end
        )
        expected = compute_training_load(daily, end, lookback_days=7)
        assert got == expected

    async def test_uses_fitted_taus_when_set(self, test_user, db_session):
        """Fitted taus change the series vs canonical constants."""
        from app.services.cycling import compute_training_load
        from app.services.cycling.training_load import (
            CTL_WARMUP_DAYS,
            training_load_for_user,
        )
        from app.services.cycling.tss import get_daily_tss

        await _make_profile(db_session, test_user, ctl_tau=30, atl_tau=5)
        await self._seed_tss(db_session, test_user)

        end = date.today()
        got = await training_load_for_user(
            db_session, test_user.id, end, lookback_days=7
        )
        daily = await get_daily_tss(
            db_session, test_user.id, end - timedelta(days=7 + CTL_WARMUP_DAYS), end
        )
        canonical = compute_training_load(daily, end, lookback_days=7)
        fitted = compute_training_load(
            daily, end, lookback_days=7, ctl_days=30, atl_days=5
        )
        assert got == fitted
        assert got != canonical
