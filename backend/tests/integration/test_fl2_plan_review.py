"""Integration tests for FL2 (weekly review + reconciliation) and QW6 backend.

Covers: POST .../days/{id}/reschedule (move + 409 on occupied),
POST .../days/{id}/substitute (convert + 422 on bad sport),
GET .../unplanned (unlinked actuals only), weekly_plan_review idempotency
(exactly one notification per week), and goal-aware adaptive (off-pace adds
a raise suggestion, met/ahead goals add nothing).

Run with: pytest tests/integration/test_fl2_plan_review.py -m integration
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


async def _make_plan(db_session, test_user, days: list[dict]):
    from app.models.training_plan import TrainingPlan, TrainingPlanDay

    plan = TrainingPlan(
        user_id=test_user.id,
        name="FL2 Plan",
        start_date=date.today() - timedelta(days=7),
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


async def _make_profile(db_session, test_user, ftp: float = 253.0):
    from app.models.cycling import CyclingProfile

    profile = CyclingProfile(
        user_id=test_user.id,
        ftp_watts=ftp,
        weight_kg=75.0,
        lactate_threshold_hr=170.0,
    )
    db_session.add(profile)
    await db_session.flush()
    return profile


def _noon_utc(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, 12, 0, tzinfo=UTC)


async def _make_activity(db_session, test_user, day: date, tag: str, **overrides):
    from app.models.activity import Activity

    fields = {
        "user_id": test_user.id,
        "source": "strava",
        "sport_type": "cycling",
        "name": f"FL2 Ride {tag}",
        "start_date": _noon_utc(day),
        "duration_seconds": 3000,  # 50 min vs planned 60
        "average_power": 180.0,  # vs planned 200
        "tss": 70.0,  # vs planned 80 → ~87% conformity
        "provider_activity_id": f"strava_fl2_{tag}",
    }
    fields.update(overrides)
    activity = Activity(**fields)
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _make_lifting(db_session, test_user, day: date):
    from app.models.lifting import LiftingSession

    session = LiftingSession(
        user_id=test_user.id,
        session_date=day,
        focus="squat",
        total_volume_kg=8000.0,
        duration_seconds=3600,
    )
    db_session.add(session)
    await db_session.flush()
    return session


def _scored_plan_days() -> list[dict]:
    """One past linked cycle day (~87%) + one upcoming day for actions."""
    return [
        {
            "day_date": date.today() - timedelta(days=1),
            "sport": "cycle",
            "planned_type": "moderate",
            "planned_duration_min": 60,
            "planned_power_watts": 200.0,
            "planned_tss": 80.0,
        },
        {
            "day_date": date.today() + timedelta(days=1),
            "sport": "cycle",
            "planned_type": "moderate",
            "planned_duration_min": 60,
            "planned_power_watts": 200.0,
            "planned_tss": 80.0,
        },
    ]


async def _link_past_day(db_session, test_user, plan):
    """Attach a matching activity to the past plan day (≈87% conformity)."""
    past = next(d for d in plan.days if d.day_date < date.today())
    activity = await _make_activity(db_session, test_user, past.day_date, tag="scored")
    past.activity_id = activity.id
    await db_session.flush()
    return past, activity


async def _make_goal(db_session, test_user, **overrides):
    from app.models.goal import Goal

    fields = {
        "user_id": test_user.id,
        "metric": "ftp_watts",
        "starting_value": 250.0,
        "target_value": 300.0,
        "current_value": 253.0,
        "target_date": date.today() + timedelta(days=30),
        "status": "active",
    }
    fields.update(overrides)
    goal = Goal(**fields)
    db_session.add(goal)
    await db_session.flush()
    return goal


async def _add_check_ins(
    db_session, test_user, goal, values: list[float], days_ago: list[int]
):
    from app.models.goal import GoalCheckIn

    for value, ago in zip(values, days_ago):
        db_session.add(
            GoalCheckIn(
                user_id=test_user.id,
                goal_id=goal.id,
                check_in_date=date.today() - timedelta(days=ago),
                value=value,
                source="auto",
            )
        )
    await db_session.flush()


# ── Reschedule ────────────────────────────────────────────────────────────


class TestRescheduleDay:
    async def test_reschedule_moves_day_and_preserves_fields(
        self, client, test_user, db_session
    ):
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": date.today() - timedelta(days=1),
                    "sport": "cycle",
                    "planned_type": "hard",
                    "planned_duration_min": 90,
                    "planned_power_watts": 220.0,
                    "planned_tss": 110.0,
                },
            ],
        )
        day = plan.days[0]
        target = date.today() + timedelta(days=6)

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{day.id}/reschedule",
            json={"target_date": target.isoformat()},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["day_date"] == target.isoformat()
        assert data["planned_type"] == "hard"
        assert data["planned_duration_min"] == 90
        assert data["planned_power_watts"] == pytest.approx(220.0)
        assert data["planned_tss"] == pytest.approx(110.0)

    async def test_reschedule_409_when_occupied(self, client, test_user, db_session):
        occupied_date = date.today() + timedelta(days=5)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": date.today() - timedelta(days=1),
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "planned_duration_min": 60,
                },
                {
                    "day_date": occupied_date,
                    "sport": "strength",
                    "planned_type": "moderate",
                    "planned_volume_kg": 8000.0,
                },
            ],
        )
        movable = next(d for d in plan.days if d.day_date < date.today())

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{movable.id}/reschedule",
            json={"target_date": occupied_date.isoformat()},
        )
        assert resp.status_code == 409

    async def test_reschedule_rejects_completed_day(
        self, client, test_user, db_session
    ):
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": date.today() - timedelta(days=1),
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "completed": True,
                },
            ],
        )
        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{plan.days[0].id}/reschedule",
            json={"target_date": (date.today() + timedelta(days=6)).isoformat()},
        )
        assert resp.status_code == 400


# ── Substitute ────────────────────────────────────────────────────────────


class TestSubstituteDay:
    async def test_substitute_converts_and_annotates(
        self, client, test_user, db_session
    ):
        missed_date = date.today() - timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": missed_date,
                    "sport": "cycle",
                    "planned_type": "hard",
                    "planned_duration_min": 90,
                    "planned_tss": 120.0,
                },
            ],
        )
        day = plan.days[0]

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{day.id}/substitute",
            json={
                "sport": "cycle",
                "planned_type": "easy",
                "planned_duration_min": 45,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["day_date"] == missed_date.isoformat()
        assert data["sport"] == "cycle"
        assert data["planned_type"] == "easy"
        assert data["planned_duration_min"] == 45
        assert "Substitut" in (data["notes"] or "")

    async def test_substitute_422_on_bad_sport(self, client, test_user, db_session):
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": date.today() - timedelta(days=2),
                    "sport": "cycle",
                    "planned_type": "hard",
                },
            ],
        )
        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{plan.days[0].id}/substitute",
            json={"sport": "swim", "planned_type": "easy"},
        )
        assert resp.status_code == 422


# ── Unplanned ─────────────────────────────────────────────────────────────


class TestUnplannedActuals:
    async def test_lists_only_unlinked_actuals(self, client, test_user, db_session):
        yesterday = date.today() - timedelta(days=1)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": yesterday,
                    "sport": "cycle",
                    "planned_type": "moderate",
                },
            ],
        )
        linked = await _make_activity(db_session, test_user, yesterday, tag="linked")
        plan.days[0].activity_id = linked.id
        unlinked = await _make_activity(db_session, test_user, yesterday, tag="free")
        extra_lift = await _make_lifting(db_session, test_user, yesterday)
        await db_session.flush()

        resp = await client.get(f"/api/v1/training-plans/{plan.id}/unplanned?days=14")
        assert resp.status_code == 200
        data = resp.json()
        activity_ids = {a["id"] for a in data["activities"]}
        assert str(unlinked.id) in activity_ids
        assert str(linked.id) not in activity_ids
        lift_ids = {s["id"] for s in data["lifting_sessions"]}
        assert str(extra_lift.id) in lift_ids


# ── Weekly review task ────────────────────────────────────────────────────


class TestWeeklyPlanReview:
    async def test_creates_exactly_one_notification_per_week(
        self, test_user, db_session
    ):
        from sqlalchemy import select

        from app.models.notification import Notification
        from app.tasks.scheduler import build_weekly_plan_review

        await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": date.today() - timedelta(days=1),
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "planned_duration_min": 60,
                },
                {
                    "day_date": date.today() + timedelta(days=1),
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "planned_duration_min": 60,
                },
            ],
        )

        first = await build_weekly_plan_review(db_session, test_user.id)
        assert first is not None
        assert first["notified"] is True
        assert first["missed_days"] == 1

        second = await build_weekly_plan_review(db_session, test_user.id)
        assert second is not None
        assert second["notified"] is False

        rows = (
            (
                await db_session.execute(
                    select(Notification).where(
                        Notification.user_id == test_user.id,
                        Notification.type == "plan_review",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].link == "/training"
        assert "Missed 1 day(s)" in rows[0].body

    async def test_no_plan_returns_none(self, test_user, db_session):
        from app.tasks.scheduler import build_weekly_plan_review

        assert await build_weekly_plan_review(db_session, test_user.id) is None


# ── QW6 goal-aware adaptive ───────────────────────────────────────────────


class TestGoalAwareAdaptive:
    async def test_off_pace_goal_adds_raise_suggestion(self, test_user, db_session):
        from app.services.adaptive import generate_adaptive_suggestions

        await _make_profile(db_session, test_user, ftp=253.0)
        plan = await _make_plan(db_session, test_user, _scored_plan_days())
        await _link_past_day(db_session, test_user, plan)
        goal = await _make_goal(db_session, test_user)
        # Slow climb: projects ~329 days out vs a 30-day target → Unlikely.
        await _add_check_ins(
            db_session,
            test_user,
            goal,
            [250.0, 251.0, 252.0, 253.0],
            [28, 21, 14, 7],
        )

        result = await generate_adaptive_suggestions(db_session, test_user.id, plan.id)
        chase = [
            s for s in result["suggestions"] if s["title"].startswith("Chase goal")
        ]
        assert len(chase) == 1
        assert chase[0]["type"] == "intensity_raise"
        assert "ftp_watts" in chase[0]["detail"]
        assert "Unlikely" in chase[0]["detail"]
        assert len(chase[0]["actions"]) > 0

    async def test_met_and_ahead_goals_add_nothing(self, test_user, db_session):
        from app.services.adaptive import generate_adaptive_suggestions

        await _make_profile(db_session, test_user, ftp=280.0)
        plan = await _make_plan(db_session, test_user, _scored_plan_days())
        await _link_past_day(db_session, test_user, plan)
        # Already achieved → excluded by status.
        await _make_goal(
            db_session,
            test_user,
            metric="ftp_watts",
            starting_value=250.0,
            target_value=260.0,
            current_value=280.0,
            status="achieved",
        )
        # Ahead of pace → On Track → deliberately no suggestion.
        ahead = await _make_goal(
            db_session,
            test_user,
            metric="weekly_tss",
            starting_value=40.0,
            target_value=120.0,
            current_value=70.0,
            target_date=date.today() + timedelta(days=60),
        )
        await _add_check_ins(
            db_session,
            test_user,
            ahead,
            [40.0, 50.0, 60.0, 70.0],
            [21, 14, 7, 1],
        )

        result = await generate_adaptive_suggestions(db_session, test_user.id, plan.id)
        assert not [
            s for s in result["suggestions"] if s["title"].startswith("Chase goal")
        ]
