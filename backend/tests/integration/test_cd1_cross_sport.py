"""Integration tests for CD1 cross-sport fatigue interference (backend).

Covers: legs-loaded → cycle suggestion eased; cycling-loaded → strength
suggestion scaled; no lifting history → no cross-sport vote; readiness cap
respected; RPE-only legs path in ``cross_sport_fatigue``.

Run with: pytest tests/integration/test_cd1_cross_sport.py -m integration
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


async def _make_plan(db_session, test_user):
    from app.models.training_plan import TrainingPlan, TrainingPlanDay

    plan = TrainingPlan(
        user_id=test_user.id,
        name="CD1 Plan",
        start_date=date.today() - timedelta(days=1),
        end_date=date.today() + timedelta(weeks=4),
        plan_type="custom",
        status="active",
    )
    db_session.add(plan)
    await db_session.flush()
    db_session.add(
        TrainingPlanDay(
            plan_id=plan.id,
            day_date=date.today() + timedelta(days=1),
            sport="cycle",
            planned_type="moderate",
            planned_duration_min=60,
            planned_power_watts=200.0,
            planned_tss=80.0,
        )
    )
    db_session.add(
        TrainingPlanDay(
            plan_id=plan.id,
            day_date=date.today() + timedelta(days=2),
            sport="strength",
            planned_type="moderate",
            planned_volume_kg=10000.0,
            planned_rpe=8.0,
        )
    )
    await db_session.flush()
    await db_session.refresh(plan, ["days"])
    return plan


def _yesterday_noon_utc() -> datetime:
    yesterday = date.today() - timedelta(days=1)
    return datetime(yesterday.year, yesterday.month, yesterday.day, 12, 0, tzinfo=UTC)


async def _seed_legs_session(db_session, test_user, **overrides):
    from app.models.lifting import LiftingSession

    fields = {
        "user_id": test_user.id,
        "session_date": date.today() - timedelta(days=1),
        "focus": "squat",
        "total_volume_kg": 8000.0,
        "rpe_session": 7.0,
    }
    fields.update(overrides)
    session = LiftingSession(**fields)
    db_session.add(session)
    await db_session.flush()
    return session


async def _seed_ride(db_session, test_user, tss: float, tag: str):
    from app.models.activity import Activity

    db_session.add(
        Activity(
            user_id=test_user.id,
            source="strava",
            sport_type="cycling",
            name=f"CD1 Ride {tag}",
            start_date=_yesterday_noon_utc(),
            duration_seconds=5400,
            tss=tss,
            provider_activity_id=f"strava_cd1_{tag}",
        )
    )
    await db_session.flush()


def _cross_sport_suggestions(result: dict) -> list[dict]:
    return [
        s
        for s in result["suggestions"]
        if s["type"] == "intensity_cut"
        and ("leg day" in s["title"] or "hard riding" in s["title"])
    ]


class TestCrossSportFatigueHelper:
    async def test_no_history_returns_unloaded(self, test_user, db_session):
        from app.services.adaptive import cross_sport_fatigue

        got = await cross_sport_fatigue(db_session, test_user.id)
        assert got["legs_loaded"] is False
        assert got["cycling_loaded"] is False

    async def test_high_rpe_legs_session_loads_legs_without_volume(
        self, test_user, db_session
    ):
        """Heavy singles (low volume, RPE 9) still flag the legs."""
        from app.services.adaptive import cross_sport_fatigue

        await _seed_legs_session(
            db_session, test_user, total_volume_kg=500.0, rpe_session=9.0
        )
        got = await cross_sport_fatigue(db_session, test_user.id)
        assert got["legs_loaded"] is True
        assert got["cycling_loaded"] is False

    async def test_upper_body_session_does_not_load_legs(self, test_user, db_session):
        from app.services.adaptive import cross_sport_fatigue

        await _seed_legs_session(
            db_session, test_user, focus="bench", total_volume_kg=12000.0
        )
        got = await cross_sport_fatigue(db_session, test_user.id)
        assert got["legs_loaded"] is False


class TestGenerateAdaptiveCrossSport:
    async def test_legs_loaded_eases_cycle_day(self, test_user, db_session):
        from app.services.adaptive import CUT_FACTOR, generate_adaptive_suggestions

        await _seed_legs_session(db_session, test_user)
        plan = await _make_plan(db_session, test_user)
        cycle_day_id = next(d.id for d in plan.days if d.sport == "cycle")

        result = await generate_adaptive_suggestions(db_session, test_user.id, plan.id)
        cross = _cross_sport_suggestions(result)
        leg_votes = [s for s in cross if "leg day" in s["title"]]
        assert len(leg_votes) == 1
        assert "lifting" in leg_votes[0]["detail"].lower()
        day_ids = [a["day_id"] for a in leg_votes[0]["actions"]]
        assert str(cycle_day_id) in day_ids
        # Clamped through existing machinery: 200 W × 0.85.
        power = next(
            a["fields"]["planned_power_watts"]
            for a in leg_votes[0]["actions"]
            if "planned_power_watts" in a["fields"]
        )
        assert power == pytest.approx(200.0 * CUT_FACTOR)
        # No strength-day vote: no cycling load seeded.
        assert not [s for s in cross if "hard riding" in s["title"]]

    async def test_cycling_loaded_scales_strength_day(self, test_user, db_session):
        from app.services.adaptive import CUT_FACTOR, generate_adaptive_suggestions

        await _seed_ride(db_session, test_user, tss=200.0, tag="hard")
        plan = await _make_plan(db_session, test_user)
        strength_day_id = next(d.id for d in plan.days if d.sport == "strength")

        result = await generate_adaptive_suggestions(db_session, test_user.id, plan.id)
        cross = _cross_sport_suggestions(result)
        ride_votes = [s for s in cross if "hard riding" in s["title"]]
        assert len(ride_votes) == 1
        day_ids = [a["day_id"] for a in ride_votes[0]["actions"]]
        assert str(strength_day_id) in day_ids
        volume = next(
            a["fields"]["planned_volume_kg"]
            for a in ride_votes[0]["actions"]
            if "planned_volume_kg" in a["fields"]
        )
        assert volume == pytest.approx(10000.0 * CUT_FACTOR)

    async def test_no_history_no_cross_sport_vote(self, test_user, db_session):
        from app.services.adaptive import generate_adaptive_suggestions

        plan = await _make_plan(db_session, test_user)
        result = await generate_adaptive_suggestions(db_session, test_user.id, plan.id)
        assert _cross_sport_suggestions(result) == []


class TestReadinessCap:
    def test_legs_loaded_caps_fresh_rider_at_z2(self):
        from app.services.workout_planner import get_readiness_recommendation

        fresh = get_readiness_recommendation(ctl=60.0, atl=50.0, tsb=10.0)
        assert fresh.recommended_max_zone == "z5"
        capped = get_readiness_recommendation(
            ctl=60.0, atl=50.0, tsb=10.0, legs_loaded=True
        )
        assert capped.recommended_max_zone == "z2"
        assert "legs" in capped.readiness_note.lower()
        assert capped.is_fatigued is True

    def test_default_behavior_unchanged_and_low_zones_untouched(self):
        from app.services.workout_planner import get_readiness_recommendation

        # Already-capped zones pass through with the original note.
        tired = get_readiness_recommendation(
            ctl=70.0, atl=100.0, tsb=-30.0, legs_loaded=True
        )
        assert tired.recommended_max_zone == "z1"
        assert "legs" not in tired.readiness_note.lower()
