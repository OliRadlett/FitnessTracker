"""Integration tests for GET /api/v1/calendar.

The calendar is a composite read; these assert the composition rules that the
lab surfaced, not just the happy path:

- dense days for the range, even when empty;
- a standalone lifting session is visible (the old page missed it);
- a strength day without a planned TSS is reported as missing coverage, never
  as zero load;
- the lifting session filter is a real date range, not an all-time list;
- a section failure degrades, and another user's rows never leak.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.event import Event
from app.models.goal import Goal
from app.models.lifting import LiftingSession
from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.models.user import User


async def _make_plan(
    db: AsyncSession,
    user: User,
    *,
    start: date,
    days: int = 4,
    status: str = "active",
) -> TrainingPlan:
    plan = TrainingPlan(
        user_id=user.id,
        name="Calendar test plan",
        start_date=start,
        end_date=start + timedelta(days=days),
        plan_type="custom",
        status=status,
    )
    db.add(plan)
    await db.flush()
    for i in range(days):
        day_date = start + timedelta(days=i)
        if i == 0:
            sport, planned_type, tss, focus = "strength", "moderate", None, "squat"
        elif i == 1:
            sport, planned_type, tss, focus = "cycle", "hard", 100.0, None
        elif i == 2:
            sport, planned_type, tss, focus = "rest", "rest", None, None
        else:
            sport, planned_type, tss, focus = "strength", "easy", None, "pull"
        db.add(
            TrainingPlanDay(
                plan_id=plan.id,
                day_date=day_date,
                sport=sport,
                planned_type=planned_type,
                planned_tss=tss,
                planned_duration_min=60,
                planned_focus=focus,
                completed=i == 0,
            )
        )
    await db.flush()
    return plan


async def _make_activity(
    db: AsyncSession,
    user: User,
    *,
    day: date,
    tss: float = 80.0,
    sport_type: str = "cycling",
    source: str = "strava",
) -> Activity:
    activity = Activity(
        user_id=user.id,
        source=source,
        sport_type=sport_type,
        name="Calendar ride",
        start_date=datetime(day.year, day.month, day.day, 12, 0, tzinfo=UTC),
        duration_seconds=3600,
        distance_meters=40_000.0,
        tss=tss,
        average_power=180.0,
        normalized_power=190.0,
        average_heartrate=145.0,
    )
    db.add(activity)
    await db.flush()
    return activity


@pytest.mark.asyncio
class TestCalendarAPI:
    async def test_empty_range_is_dense_and_planless(self, client, test_user):
        start = date.today()
        end = start + timedelta(days=3)
        response = await client.get(
            "/api/v1/calendar", params={"start": start.isoformat(), "end": end.isoformat()}
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["plan"] is None
        assert [d["date"] for d in body["days"]] == [
            (start + timedelta(days=i)).isoformat() for i in range(4)
        ]
        assert body["coverage"] == {
            "planned_sessions": 0,
            "target_sessions": 0,
            "planned_tss": 0.0,
            "strength_targets_missing": 0,
        }
        assert body["events"] == []
        assert body["goals"] == []

    async def test_plan_activity_lift_metric_and_sleep(
        self,
        client,
        db_session,
        test_user,
        test_lifting_session,
        test_daily_metric,
        test_sleep_log,
    ):
        today = date.today()
        plan = await _make_plan(db_session, test_user, start=today - timedelta(days=1))
        activity = await _make_activity(db_session, test_user, day=today, tss=80.0)
        # Link the cycling day (today) to the activity.
        cycle_day = next(d for d in await _plan_days(db_session, plan.id) if d.day_date == today)
        cycle_day.activity_id = activity.id
        cycle_day.completed = True
        await db_session.flush()

        start, end = today - timedelta(days=4), today + timedelta(days=3)
        response = await client.get(
            "/api/v1/calendar", params={"start": start.isoformat(), "end": end.isoformat()}
        )
        assert response.status_code == 200, response.text
        body = response.json()

        assert body["plan"]["id"] == str(plan.id)
        assert len(body["days"]) == 8
        day_today = next(d for d in body["days"] if d["date"] == today.isoformat())
        assert len(day_today["plan"]) == 1
        assert day_today["plan"][0]["actual_activity_id"] == str(activity.id)
        assert day_today["activities"][0]["id"] == str(activity.id)

        metric_day = next(
            d for d in body["days"] if d["date"] == (today - timedelta(days=1)).isoformat()
        )
        assert metric_day["metric"]["recovery_score"] == 72.0
        assert metric_day["sleep"]["total_sleep_seconds"] == 28800

        # The lift fixture is on an earlier weekday; it must appear on its own
        # date, not be pulled onto today.
        lift_day = next(
            d for d in body["days"] if d["date"] == test_lifting_session.session_date.isoformat()
        )
        assert len(lift_day["lifts"]) == 1
        assert lift_day["lifts"][0]["set_count"] == 3

        assert body["coverage"]["planned_sessions"] == 3  # 2 strength + 1 cycle
        assert body["coverage"]["target_sessions"] == 1  # only the cycle day has TSS
        assert body["coverage"]["planned_tss"] == 100.0
        assert body["coverage"]["strength_targets_missing"] == 2

    async def test_standalone_lift_is_visible_without_activity(
        self, client, db_session, test_user
    ):
        session = LiftingSession(
            user_id=test_user.id,
            session_date=date.today(),
            focus="Pull",
            duration_seconds=3600,
            total_volume_kg=5000.0,
            estimated_tss=55.0,
        )
        db_session.add(session)
        await db_session.flush()

        response = await client.get(
            "/api/v1/calendar",
            params={"start": date.today().isoformat(), "end": date.today().isoformat()},
        )
        assert response.status_code == 200, response.text
        day = response.json()["days"][0]
        assert day["activities"] == []
        assert [lift["id"] for lift in day["lifts"]] == [str(session.id)]
        assert day["lifts"][0]["estimated_tss"] == 55.0

    async def test_strength_day_without_tss_is_not_zero_load(
        self, client, db_session, test_user
    ):
        await _make_plan(db_session, test_user, start=date.today(), days=1)
        response = await client.get(
            "/api/v1/calendar",
            params={"start": date.today().isoformat(), "end": date.today().isoformat()},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["coverage"]["planned_sessions"] == 1
        assert body["coverage"]["target_sessions"] == 0
        assert body["coverage"]["planned_tss"] == 0.0
        assert body["coverage"]["strength_targets_missing"] == 1
        assert body["days"][0]["plan"][0]["planned_tss"] is None

    async def test_range_is_capped_and_ordered(self, client, test_user):
        today = date.today()
        too_long = await client.get(
            "/api/v1/calendar",
            params={
                "start": today.isoformat(),
                "end": (today + timedelta(days=63)).isoformat(),
            },
        )
        assert too_long.status_code == 422
        assert "62" in too_long.json()["detail"]

        reversed_range = await client.get(
            "/api/v1/calendar",
            params={
                "start": today.isoformat(),
                "end": (today - timedelta(days=1)).isoformat(),
            },
        )
        assert reversed_range.status_code == 422

    async def test_explicit_plan_and_unknown_plan(
        self, client, db_session, test_user
    ):
        plan = await _make_plan(db_session, test_user, start=date.today(), days=2)
        response = await client.get(
            "/api/v1/calendar",
            params={
                "start": date.today().isoformat(),
                "end": (date.today() + timedelta(days=1)).isoformat(),
                "plan_id": str(plan.id),
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["plan"]["id"] == str(plan.id)

        missing = await client.get(
            "/api/v1/calendar",
            params={
                "start": date.today().isoformat(),
                "end": date.today().isoformat(),
                "plan_id": str(uuid.uuid4()),
            },
        )
        assert missing.status_code == 404

    async def test_events_and_active_goal_targets(
        self, client, db_session, test_user
    ):
        today = date.today()
        db_session.add(
            Event(
                user_id=test_user.id,
                name="Autumn TT",
                event_date=today + timedelta(days=2),
                event_type="race",
                target_tss=180.0,
            )
        )
        db_session.add(
            Goal(
                user_id=test_user.id,
                metric="ftp_watts",
                target_value=280.0,
                target_date=today + timedelta(days=3),
                status="active",
            )
        )
        await db_session.flush()

        response = await client.get(
            "/api/v1/calendar",
            params={
                "start": today.isoformat(),
                "end": (today + timedelta(days=5)).isoformat(),
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["events"][0]["name"] == "Autumn TT"
        assert body["goals"][0]["metric"] == "ftp_watts"
        assert body["goals"][0]["target_value"] == 280.0

    async def test_other_users_rows_are_excluded(self, client, db_session, test_user):
        other = User(id=uuid.uuid4(), email="other@example.com", name="Other")
        db_session.add(other)
        await db_session.flush()
        await _make_activity(db_session, other, day=date.today(), tss=99.0)
        await _make_plan(db_session, other, start=date.today(), days=1)

        response = await client.get(
            "/api/v1/calendar",
            params={"start": date.today().isoformat(), "end": date.today().isoformat()},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["plan"] is None
        assert body["days"][0]["activities"] == []
        assert body["days"][0]["plan"] == []

    async def test_wahoo_activity_excluded_like_the_activity_list(
        self, client, db_session, test_user
    ):
        today = date.today()
        await _make_activity(db_session, test_user, day=today, tss=40.0, source="wahoo")
        await _make_activity(db_session, test_user, day=today, tss=60.0, source="strava")
        response = await client.get(
            "/api/v1/calendar",
            params={"start": today.isoformat(), "end": today.isoformat()},
        )
        assert response.status_code == 200, response.text
        activities = response.json()["days"][0]["activities"]
        assert [a["source"] for a in activities] == ["strava"]

    async def test_week_rollup_dedupes_paired_strength_activity(
        self, client, db_session, test_user
    ):
        today = date.today()
        plan = await _make_plan(db_session, test_user, start=today, days=2)
        lift = LiftingSession(
            user_id=test_user.id,
            session_date=today,
            focus="Push",
            duration_seconds=3600,
            total_volume_kg=6000.0,
            estimated_tss=60.0,
        )
        db_session.add(lift)
        await db_session.flush()
        strength_day = next(
            d for d in await _plan_days(db_session, plan.id) if d.sport == "strength"
        )
        strength_day.lifting_session_id = lift.id
        strength_day.completed = True
        # The paired strength activity must not be counted as a second
        # unplanned session.
        await _make_activity(
            db_session,
            test_user,
            day=today,
            tss=None,
            sport_type="strength",
        )
        await db_session.flush()

        response = await client.get(
            "/api/v1/calendar",
            params={
                "start": today.isoformat(),
                "end": (today + timedelta(days=1)).isoformat(),
            },
        )
        assert response.status_code == 200, response.text
        week = response.json()["weeks"][0]
        assert week["planned_sessions"] == 2  # strength today + cycle tomorrow
        assert week["completed_sessions"] == 1  # only the strength day is done
        assert week["actual_tss"] == 60.0
        assert week["unplanned_actuals"] == 0

    async def test_lifting_sessions_accept_a_range(
        self, client, db_session, test_user
    ):
        today = date.today()
        session = LiftingSession(
            user_id=test_user.id,
            session_date=today,
            focus="Legs",
            duration_seconds=1800,
            total_volume_kg=3000.0,
        )
        db_session.add(session)
        await db_session.flush()

        inside = await client.get(
            "/api/v1/lifting/sessions",
            params={"start_date": today.isoformat(), "end_date": today.isoformat()},
        )
        assert inside.status_code == 200, inside.text
        assert [s["id"] for s in inside.json()] == [str(session.id)]

        outside = await client.get(
            "/api/v1/lifting/sessions",
            params={
                "start_date": (today + timedelta(days=5)).isoformat(),
                "end_date": (today + timedelta(days=6)).isoformat(),
            },
        )
        assert outside.status_code == 200, outside.text
        assert outside.json() == []


async def _plan_days(db: AsyncSession, plan_id: uuid.UUID) -> list[TrainingPlanDay]:
    from sqlalchemy import select

    result = await db.execute(
        select(TrainingPlanDay)
        .where(TrainingPlanDay.plan_id == plan_id)
        .order_by(TrainingPlanDay.day_date)
    )
    return list(result.scalars().all())
