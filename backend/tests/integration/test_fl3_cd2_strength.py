"""Integration tests for FL3 e1RM/RPE autoregulation + CD2 recovery→strength (backend).

Covers: POST /lifting/suggest-load from PR / recent sets / none + pct
validation; POST /training-plans/{id}/refresh-targets strength recompute on
PR change + basis-less skip; ``strength_readiness`` low/normal/high gating;
adaptive strength actions carrying the CD2 modulation.

Run with: pytest tests/integration/test_fl3_cd2_strength.py -m integration
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── Helpers ────────────────────────────────────────────────────────────────


async def _make_plan(db_session, test_user, days: list[dict]):
    from app.models.training_plan import TrainingPlan, TrainingPlanDay

    plan = TrainingPlan(
        user_id=test_user.id,
        name="FL3 Plan",
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


async def _seed_pr(db_session, test_user, name="Back Squat", e1rm=180.0):
    from app.models.lifting import PersonalRecord

    pr = PersonalRecord(
        user_id=test_user.id,
        exercise_name=name,
        record_type="1rm",
        weight_kg=e1rm,
        reps=1,
        estimated_1rm=e1rm,
        achieved_date=date.today() - timedelta(days=7),
    )
    db_session.add(pr)
    await db_session.flush()
    return pr


async def _seed_sets(db_session, test_user, name="Back Squat", weight=100.0, reps=5):
    """Raw session + sets (bypasses the service so no PR row is created)."""
    from app.models.lifting import LiftingSession, LiftingSet

    session = LiftingSession(
        user_id=test_user.id,
        session_date=date.today() - timedelta(days=2),
        focus="squat",
        total_volume_kg=weight * reps,
        rpe_session=7.0,
    )
    db_session.add(session)
    await db_session.flush()
    db_session.add(
        LiftingSet(
            session_id=session.id,
            exercise_name=name,
            set_number=1,
            weight_kg=weight,
            reps=reps,
        )
    )
    await db_session.flush()
    return session


async def _seed_metric(db_session, test_user, day_offset: int, **fields):
    from app.models.daily_metric import DailyMetric

    metric = DailyMetric(
        user_id=test_user.id,
        metric_date=date.today() + timedelta(days=day_offset),
        source="whoop",
        **fields,
    )
    db_session.add(metric)
    await db_session.flush()
    return metric


async def _seed_session_rpe(db_session, test_user, day_offset: int, rpe: float):
    from app.models.lifting import LiftingSession

    session = LiftingSession(
        user_id=test_user.id,
        session_date=date.today() + timedelta(days=day_offset),
        focus="squat",
        total_volume_kg=5000.0,
        rpe_session=rpe,
    )
    db_session.add(session)
    await db_session.flush()
    return session


async def _seed_alert(db_session, test_user):
    from app.models.health_alert import HealthAlert

    alert = HealthAlert(
        user_id=test_user.id,
        alert_type="overtraining",
        severity="warning",
        title="Overtraining Risk",
        description="Load is elevated.",
        evidence={},
        detected_date=date.today(),
        status="active",
    )
    db_session.add(alert)
    await db_session.flush()
    return alert


async def _seed_ride(db_session, test_user, days_ago: int, tss: float, tag: str):
    from app.models.activity import Activity

    day = date.today() - timedelta(days=days_ago)
    db_session.add(
        Activity(
            user_id=test_user.id,
            source="strava",
            sport_type="cycling",
            name=f"FL3 Ride {tag}",
            start_date=datetime(day.year, day.month, day.day, 12, 0, tzinfo=UTC),
            duration_seconds=5400,
            tss=tss,
            provider_activity_id=f"strava_fl3_{tag}",
        )
    )
    await db_session.flush()


# ── FL3: suggest-load ──────────────────────────────────────────────────────


class TestSuggestLoad:
    async def test_from_pr_with_alias(self, client, test_user, db_session):
        """Stored PR wins; the alias normaliser maps 'squat' → 'Back Squat'."""
        await _seed_pr(db_session, test_user, e1rm=180.0)
        resp = await client.post(
            "/api/v1/lifting/suggest-load",
            json={"exercise_name": "squat", "sets": 5, "reps": 5, "pct_1rm": 0.8},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["basis_source"] == "pr"
        assert data["basis_1rm_kg"] == pytest.approx(180.0)
        assert data["target_kg"] == pytest.approx(144.0)
        assert data["pct_1rm"] == pytest.approx(0.8)

    async def test_from_recent_sets(self, client, test_user, db_session):
        """No PR → best-set Brzycki (100×5 = 112.5), default pct 0.8."""
        await _seed_sets(db_session, test_user, weight=100.0, reps=5)
        resp = await client.post(
            "/api/v1/lifting/suggest-load",
            json={"exercise_name": "Back Squat", "sets": 5, "reps": 5},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["basis_source"] == "recent_sets"
        assert data["basis_1rm_kg"] == pytest.approx(112.5)
        assert data["target_kg"] == pytest.approx(90.0)

    async def test_no_history_returns_none_basis(self, client):
        resp = await client.post(
            "/api/v1/lifting/suggest-load",
            json={"exercise_name": "Deadlift", "sets": 4, "reps": 3},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["basis_source"] == "none"
        assert data["target_kg"] is None
        assert data["basis_1rm_kg"] is None

    async def test_pct_and_scheme_validation(self, client):
        for payload in [
            {"exercise_name": "Back Squat", "sets": 5, "reps": 5, "pct_1rm": 1.5},
            {"exercise_name": "Back Squat", "sets": 5, "reps": 5, "pct_1rm": 0.1},
            {"exercise_name": "Back Squat", "sets": 0, "reps": 5},
            {"exercise_name": "Back Squat", "sets": 5, "reps": 0},
        ]:
            resp = await client.post("/api/v1/lifting/suggest-load", json=payload)
            assert resp.status_code == 422, payload


# ── FL3: refresh strength targets ──────────────────────────────────────────


STRENGTH_DAY = {
    "day_date": date.today() + timedelta(days=1),
    "sport": "strength",
    "planned_type": "moderate",
    "planned_exercises": [
        {
            "exercise": "Back Squat",
            "sets": 5,
            "reps": 5,
            "weight_kg": 100.0,
            "pct_1rm": 0.8,
        }
    ],
    "planned_volume_kg": 2500.0,
}


class TestRefreshStrengthTargets:
    async def _plan(self, db_session, test_user):
        import copy

        return await _make_plan(
            db_session,
            test_user,
            [
                copy.deepcopy(STRENGTH_DAY),
                {
                    # No %e1RM basis → skipped.
                    "day_date": date.today() + timedelta(days=2),
                    "sport": "strength",
                    "planned_type": "moderate",
                    "planned_exercises": [
                        {
                            "exercise": "Bench Press",
                            "sets": 3,
                            "reps": 10,
                            "weight_kg": None,
                        }
                    ],
                },
                {
                    # Completed with basis → never touched.
                    "day_date": date.today() + timedelta(days=3),
                    "sport": "strength",
                    "planned_type": "moderate",
                    "planned_exercises": [
                        {
                            "exercise": "Back Squat",
                            "sets": 5,
                            "reps": 5,
                            "weight_kg": 100.0,
                            "pct_1rm": 0.8,
                        }
                    ],
                    "completed": True,
                },
                {
                    # Past with basis → never touched.
                    "day_date": date.today() - timedelta(days=1),
                    "sport": "strength",
                    "planned_type": "moderate",
                    "planned_exercises": [
                        {
                            "exercise": "Back Squat",
                            "sets": 5,
                            "reps": 5,
                            "weight_kg": 100.0,
                            "pct_1rm": 0.8,
                        }
                    ],
                },
            ],
        )

    async def test_refresh_resolves_basis_and_skips_rest(
        self, client, test_user, db_session
    ):
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await self._plan(db_session, test_user)

        resp = await client.post(f"/api/v1/training-plans/{plan.id}/refresh-targets")
        assert resp.status_code == 200
        data = resp.json()

        # FL1 envelope intact (additive strength key only).
        assert "refreshed" in data
        assert "strength_days_skipped" in data
        assert data["strength_days_skipped"] == 2

        assert len(data["strength_refreshed"]) == 1
        entry = data["strength_refreshed"][0]
        assert entry["exercise"] == "Back Squat"
        assert entry["old_weight_kg"] == pytest.approx(100.0)
        assert entry["new_weight_kg"] == pytest.approx(144.0)
        assert entry["basis_source"] == "pr"

        from sqlalchemy import select

        from app.models.training_plan import TrainingPlanDay

        rows = (await db_session.execute(select(TrainingPlanDay))).scalars().all()
        by_date = {r.day_date: r for r in rows}
        tomorrow = by_date[date.today() + timedelta(days=1)]
        assert tomorrow.planned_exercises[0]["weight_kg"] == pytest.approx(144.0)
        # Basis key preserved; volume re-derived (144 × 5 × 5).
        assert tomorrow.planned_exercises[0]["pct_1rm"] == pytest.approx(0.8)
        assert tomorrow.planned_volume_kg == pytest.approx(3600.0)
        # Basis-less / completed / past days untouched.
        assert (
            by_date[date.today() + timedelta(days=2)].planned_exercises[0]["weight_kg"]
            is None
        )
        assert by_date[date.today() + timedelta(days=3)].planned_exercises[0][
            "weight_kg"
        ] == pytest.approx(100.0)
        assert by_date[date.today() - timedelta(days=1)].planned_exercises[0][
            "weight_kg"
        ] == pytest.approx(100.0)

    async def test_refresh_recomputes_on_pr_change(self, client, test_user, db_session):
        pr = await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await self._plan(db_session, test_user)

        first = await client.post(f"/api/v1/training-plans/{plan.id}/refresh-targets")
        assert first.status_code == 200
        assert len(first.json()["strength_refreshed"]) == 1

        pr.estimated_1rm = 200.0
        await db_session.flush()

        second = await client.post(f"/api/v1/training-plans/{plan.id}/refresh-targets")
        assert second.status_code == 200
        refreshed = second.json()["strength_refreshed"]
        assert len(refreshed) == 1
        assert refreshed[0]["old_weight_kg"] == pytest.approx(144.0)
        assert refreshed[0]["new_weight_kg"] == pytest.approx(160.0)

        # Third call is a no-op (within epsilon of stored).
        third = await client.post(f"/api/v1/training-plans/{plan.id}/refresh-targets")
        assert third.status_code == 200
        assert third.json()["strength_refreshed"] == []

    async def test_day_update_accepts_basis_keys(self, client, test_user, db_session):
        """PATCH with pct_1rm/target_rpe validates ranges, stores the basis."""
        plan = await self._plan(db_session, test_user)
        day_id = next(
            d.id for d in plan.days if d.day_date == date.today() + timedelta(days=2)
        )
        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}/days/{day_id}",
            json={
                "planned_exercises": [
                    {
                        "exercise": "Bench Press",
                        "sets": 5,
                        "reps": 5,
                        "weight_kg": None,
                        "pct_1rm": 0.75,
                        "target_rpe": 8.0,
                    }
                ]
            },
        )
        assert resp.status_code == 200
        entry = resp.json()["planned_exercises"][0]
        assert entry["pct_1rm"] == pytest.approx(0.75)
        assert entry["target_rpe"] == pytest.approx(8.0)

        bad = await client.patch(
            f"/api/v1/training-plans/{plan.id}/days/{day_id}",
            json={
                "planned_exercises": [
                    {
                        "exercise": "Bench Press",
                        "sets": 5,
                        "reps": 5,
                        "pct_1rm": 1.5,
                    }
                ]
            },
        )
        assert bad.status_code == 422


# ── CD2: strength readiness ────────────────────────────────────────────────


class TestStrengthReadiness:
    async def test_low_recovery_scales_down(self, test_user, db_session):
        from app.services.adaptive import strength_readiness

        await _seed_metric(db_session, test_user, 0, recovery_score=30.0)
        got = await strength_readiness(db_session, test_user.id)
        assert got["factor"] == pytest.approx(0.9)
        assert "30" in got["note"]

    async def test_hrv_drop_scales_down(self, test_user, db_session):
        from app.services.adaptive import strength_readiness

        for off in range(-6, -1):
            await _seed_metric(db_session, test_user, off, hrv_ms=80.0)
        await _seed_metric(db_session, test_user, 0, recovery_score=70.0, hrv_ms=50.0)
        got = await strength_readiness(db_session, test_user.id)
        assert got["factor"] == pytest.approx(0.9)
        assert "HRV" in got["note"]

    async def test_steady_state_neutral(self, test_user, db_session):
        from app.services.adaptive import strength_readiness

        await _seed_metric(db_session, test_user, 0, recovery_score=70.0)
        got = await strength_readiness(db_session, test_user.id)
        assert got["factor"] == pytest.approx(1.0)

    async def test_high_recovery_easy_rpe_no_alerts_scales_up(
        self, test_user, db_session
    ):
        from app.services.adaptive import strength_readiness

        await _seed_metric(db_session, test_user, 0, recovery_score=85.0)
        await _seed_session_rpe(db_session, test_user, -2, 5.0)
        await _seed_session_rpe(db_session, test_user, -4, 5.5)
        got = await strength_readiness(db_session, test_user.id)
        assert got["factor"] == pytest.approx(1.05)
        assert "85" in got["note"]

    async def test_upside_blocked_by_alert(self, test_user, db_session):
        from app.services.adaptive import strength_readiness

        await _seed_metric(db_session, test_user, 0, recovery_score=85.0)
        await _seed_session_rpe(db_session, test_user, -2, 5.0)
        await _seed_alert(db_session, test_user)
        got = await strength_readiness(db_session, test_user.id)
        assert got["factor"] == pytest.approx(1.0)

    async def test_upside_blocked_by_hard_rpe(self, test_user, db_session):
        from app.services.adaptive import strength_readiness

        await _seed_metric(db_session, test_user, 0, recovery_score=85.0)
        await _seed_session_rpe(db_session, test_user, -2, 9.0)
        got = await strength_readiness(db_session, test_user.id)
        assert got["factor"] == pytest.approx(1.0)


# ── CD2: adaptive wiring ───────────────────────────────────────────────────


async def _strength_plan(db_session, test_user):
    return await _make_plan(
        db_session,
        test_user,
        [
            {
                "day_date": date.today() + timedelta(days=1),
                "sport": "cycle",
                "planned_type": "moderate",
                "planned_duration_min": 60,
                "planned_power_watts": 200.0,
                "planned_tss": 80.0,
            },
            {
                "day_date": date.today() + timedelta(days=2),
                "sport": "strength",
                "planned_type": "moderate",
                "planned_volume_kg": 10000.0,
                "planned_rpe": 8.0,
            },
        ],
    )


def _main_scale_suggestions(result: dict, kind: str) -> list[dict]:
    """Main intensity cut/raise suggestions (excludes CD1 cross-sport votes)."""
    titles = {
        "cut": "Ease the next sessions",
        "raise": "Lean into the freshness",
    }
    return [
        s
        for s in result["suggestions"]
        if s["type"] == f"intensity_{kind}" and s["title"] == titles[kind]
    ]


class TestAdaptiveStrengthModulation:
    async def test_cut_path_carries_down_modulation(self, test_user, db_session):
        # Low recovery alone yields rest_day (no scale suggestion), so the
        # down-modulation on a cut rides the HRV gate: neutral recovery (60)
        # keeps the TSB load axis alive while a sharp HRV drop scales 0.9.
        from app.services.adaptive import CUT_FACTOR, generate_adaptive_suggestions

        await _seed_metric(db_session, test_user, 0, recovery_score=60.0, hrv_ms=50.0)
        for off in range(-5, 0):
            await _seed_metric(db_session, test_user, off, hrv_ms=80.0)
        await _seed_ride(db_session, test_user, days_ago=1, tss=400.0, tag="big")
        plan = await _strength_plan(db_session, test_user)
        strength_id = next(d.id for d in plan.days if d.sport == "strength")
        cycle_id = next(d.id for d in plan.days if d.sport == "cycle")

        result = await generate_adaptive_suggestions(db_session, test_user.id, plan.id)
        matches = _main_scale_suggestions(result, "cut")
        assert len(matches) == 1
        actions = {a["day_id"]: a["fields"] for a in matches[0]["actions"]}
        # Strength volume: cut × readiness-down, still clamped.
        assert actions[str(strength_id)]["planned_volume_kg"] == pytest.approx(
            10000.0 * CUT_FACTOR * 0.9
        )
        # Cycle logic untouched by CD2.
        assert actions[str(cycle_id)]["planned_power_watts"] == pytest.approx(
            200.0 * CUT_FACTOR
        )
        assert "Readiness check" in matches[0]["detail"]

    async def test_neutral_readiness_leaves_actions_unchanged(
        self, test_user, db_session
    ):
        from app.services.adaptive import CUT_FACTOR, generate_adaptive_suggestions

        await _seed_metric(db_session, test_user, 0, recovery_score=70.0)
        await _seed_ride(db_session, test_user, days_ago=1, tss=400.0, tag="big2")
        plan = await _strength_plan(db_session, test_user)
        strength_id = next(d.id for d in plan.days if d.sport == "strength")

        result = await generate_adaptive_suggestions(db_session, test_user.id, plan.id)
        matches = _main_scale_suggestions(result, "cut")
        assert len(matches) == 1
        actions = {a["day_id"]: a["fields"] for a in matches[0]["actions"]}
        assert actions[str(strength_id)]["planned_volume_kg"] == pytest.approx(
            10000.0 * CUT_FACTOR
        )
        assert "Readiness check" not in matches[0]["detail"]

    async def test_raise_path_carries_up_modulation(self, test_user, db_session):
        from app.services.adaptive import RAISE_FACTOR, generate_adaptive_suggestions

        await _seed_metric(db_session, test_user, 0, recovery_score=85.0)
        await _seed_session_rpe(db_session, test_user, -2, 5.0)
        await _seed_session_rpe(db_session, test_user, -4, 5.5)
        for i, ago in enumerate((29, 28, 27, 26)):
            await _seed_ride(
                db_session, test_user, days_ago=ago, tss=200.0, tag=f"base{i}"
            )
        plan = await _strength_plan(db_session, test_user)
        strength_id = next(d.id for d in plan.days if d.sport == "strength")

        result = await generate_adaptive_suggestions(db_session, test_user.id, plan.id)
        matches = _main_scale_suggestions(result, "raise")
        assert len(matches) == 1
        actions = {a["day_id"]: a["fields"] for a in matches[0]["actions"]}
        assert actions[str(strength_id)]["planned_volume_kg"] == pytest.approx(
            10000.0 * RAISE_FACTOR * 1.05
        )
        assert "Readiness check" in matches[0]["detail"]
