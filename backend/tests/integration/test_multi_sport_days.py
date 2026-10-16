"""Integration tests for multi-sport plan dates.

A plan date may hold more than one session — a morning ride and an evening
lift — which means more than one ``TrainingPlanDay`` row per
``(plan_id, day_date)``, distinguished by ``sport``. These tests pin the
invariants that make that safe:

- sessions on a date are distinct by sport (no two ``cycle`` rows on one date);
- ``rest`` is exclusive (a rest row never shares a date with a session);
- each row links and scores against its *own* actual.

Run with:  pytest tests/integration/test_multi_sport_days.py -m integration
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]

TODAY = date.today()


async def _make_plan(db_session, test_user, days: list[dict]):
    from app.models.training_plan import TrainingPlan, TrainingPlanDay

    plan = TrainingPlan(
        user_id=test_user.id,
        name="Multi-sport Plan",
        start_date=TODAY - timedelta(days=7),
        end_date=TODAY + timedelta(weeks=4),
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


async def _rows_on(db_session, plan, day_date: date):
    from sqlalchemy import select

    from app.models.training_plan import TrainingPlanDay

    rows = (
        (
            await db_session.execute(
                select(TrainingPlanDay).where(
                    TrainingPlanDay.plan_id == plan.id,
                    TrainingPlanDay.day_date == day_date,
                )
            )
        )
        .scalars()
        .all()
    )
    return rows


async def _make_activity(db_session, test_user, day: date, **overrides):
    from app.models.activity import Activity

    fields = {
        "user_id": test_user.id,
        "source": "strava",
        "sport_type": "cycling",
        "name": "Multi-sport Ride",
        "start_date": datetime(day.year, day.month, day.day, 7, 0, tzinfo=UTC),
        "duration_seconds": 3600,
        "tss": 60.0,
        "provider_activity_id": f"strava_multi_{day.isoformat()}",
    }
    fields.update(overrides)
    activity = Activity(**fields)
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _make_lifting(db_session, test_user, day: date, **overrides):
    from app.models.lifting import LiftingSession

    fields = {
        "user_id": test_user.id,
        "session_date": day,
        "focus": "squat",
        "total_volume_kg": 8000.0,
        "duration_seconds": 3600,
    }
    fields.update(overrides)
    session = LiftingSession(**fields)
    db_session.add(session)
    await db_session.flush()
    return session


# ── Two sports on one date ──────────────────────────────────────────────────


class TestAddSecondSession:
    async def test_two_sports_on_one_date_both_persist(
        self, client, test_user, db_session
    ):
        """Adding a lift to a ride's date inserts a second row, not a 409."""
        shared = TODAY + timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": shared,
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "planned_duration_min": 60,
                }
            ],
        )

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days",
            json={
                "day_date": shared.isoformat(),
                "sport": "strength",
                "planned_type": "moderate",
                "planned_focus": "squat",
            },
        )
        assert resp.status_code == 201
        assert resp.json()["sport"] == "strength"

        rows = await _rows_on(db_session, plan, shared)
        assert sorted(r.sport for r in rows) == ["cycle", "strength"]

    async def test_second_session_of_the_same_sport_returns_409(
        self, client, test_user, db_session
    ):
        shared = TODAY + timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [{"day_date": shared, "sport": "cycle", "planned_type": "easy"}],
        )

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days",
            json={
                "day_date": shared.isoformat(),
                "sport": "cycle",
                "planned_type": "hard",
            },
        )
        assert resp.status_code == 409
        assert "cycle" in resp.json()["detail"]
        assert len(await _rows_on(db_session, plan, shared)) == 1

    async def test_session_on_a_rest_date_returns_409(
        self, client, test_user, db_session
    ):
        """`rest` is exclusive: a session may not join a rest row's date."""
        shared = TODAY + timedelta(days=3)
        plan = await _make_plan(
            db_session,
            test_user,
            [{"day_date": shared, "sport": "rest", "planned_type": "rest"}],
        )

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days",
            json={
                "day_date": shared.isoformat(),
                "sport": "cycle",
                "planned_type": "easy",
            },
        )
        assert resp.status_code == 409
        assert len(await _rows_on(db_session, plan, shared)) == 1

    async def test_rest_on_a_session_date_returns_409(
        self, client, test_user, db_session
    ):
        """The reverse direction of rest exclusivity."""
        shared = TODAY + timedelta(days=3)
        plan = await _make_plan(
            db_session,
            test_user,
            [{"day_date": shared, "sport": "cycle", "planned_type": "easy"}],
        )

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days",
            json={
                "day_date": shared.isoformat(),
                "sport": "rest",
                "planned_type": "rest",
            },
        )
        assert resp.status_code == 409
        assert len(await _rows_on(db_session, plan, shared)) == 1


# ── Rescheduling across sports ──────────────────────────────────────────────


class TestRescheduleAcrossSports:
    async def test_ride_moves_onto_a_lift_day(self, client, test_user, db_session):
        """A missed ride may join a lift day — the date holds both."""
        target = TODAY + timedelta(days=4)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": TODAY - timedelta(days=1),
                    "sport": "cycle",
                    "planned_type": "hard",
                    "planned_tss": 110.0,
                },
                {
                    "day_date": target,
                    "sport": "strength",
                    "planned_type": "moderate",
                    "planned_volume_kg": 8000.0,
                },
            ],
        )
        ride = next(d for d in plan.days if d.sport == "cycle")

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{ride.id}/reschedule",
            json={"target_date": target.isoformat()},
        )
        assert resp.status_code == 200
        assert resp.json()["day_date"] == target.isoformat()

        rows = await _rows_on(db_session, plan, target)
        assert sorted(r.sport for r in rows) == ["cycle", "strength"]

    async def test_ride_does_not_move_onto_a_cycle_day(
        self, client, test_user, db_session
    ):
        """Two rides on one date stay refused."""
        target = TODAY + timedelta(days=4)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": TODAY - timedelta(days=1),
                    "sport": "cycle",
                    "planned_type": "hard",
                },
                {"day_date": target, "sport": "cycle", "planned_type": "easy"},
            ],
        )
        ride = next(
            d
            for d in plan.days
            if d.sport == "cycle" and d.day_date < TODAY
        )

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{ride.id}/reschedule",
            json={"target_date": target.isoformat()},
        )
        assert resp.status_code == 409
        assert len(await _rows_on(db_session, plan, target)) == 1

    async def test_rest_does_not_move_onto_a_session_date(
        self, client, test_user, db_session
    ):
        """Moving a rest row onto a session date would break rest exclusivity."""
        target = TODAY + timedelta(days=4)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": TODAY - timedelta(days=2), "sport": "rest", "planned_type": "rest"},
                {"day_date": target, "sport": "cycle", "planned_type": "easy"},
            ],
        )
        rest = next(d for d in plan.days if d.sport == "rest")

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{rest.id}/reschedule",
            json={"target_date": target.isoformat()},
        )
        assert resp.status_code == 409

    async def test_completed_session_does_not_block_a_move(
        self, client, test_user, db_session
    ):
        """A day that was already ridden does not bar a missed ride from joining it."""
        target = TODAY + timedelta(days=4)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": TODAY - timedelta(days=1),
                    "sport": "cycle",
                    "planned_type": "hard",
                },
                {
                    "day_date": target,
                    "sport": "cycle",
                    "planned_type": "easy",
                    "completed": True,
                },
            ],
        )
        missed = next(
            d for d in plan.days if d.sport == "cycle" and d.day_date < TODAY
        )

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{missed.id}/reschedule",
            json={"target_date": target.isoformat()},
        )
        assert resp.status_code == 200


# ── Copying onto a shared date ──────────────────────────────────────────────


class TestCopyDayToDate:
    async def test_copy_onto_a_different_sport_date_is_allowed(
        self, client, test_user, db_session
    ):
        target = TODAY + timedelta(days=5)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": TODAY + timedelta(days=1), "sport": "cycle", "planned_type": "easy"},
                {"day_date": target, "sport": "strength", "planned_type": "moderate"},
            ],
        )
        ride = next(d for d in plan.days if d.sport == "cycle")

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{ride.id}"
            f"/copy-to-date/{target.isoformat()}"
        )
        assert resp.status_code == 201
        assert sorted(r.sport for r in await _rows_on(db_session, plan, target)) == [
            "cycle",
            "strength",
        ]

    async def test_copy_onto_a_same_sport_date_is_refused(
        self, client, test_user, db_session
    ):
        target = TODAY + timedelta(days=5)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": TODAY + timedelta(days=1), "sport": "cycle", "planned_type": "easy"},
                {"day_date": target, "sport": "cycle", "planned_type": "moderate"},
            ],
        )
        ride = next(d for d in plan.days if d.day_date == TODAY + timedelta(days=1))

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{ride.id}"
            f"/copy-to-date/{target.isoformat()}"
        )
        # One rule, one status: add / reschedule / substitute / patch all answer
        # 409 for a date clash, so a copy does too.
        assert resp.status_code == 409


# ── Each row links its own actual ───────────────────────────────────────────


class TestLinking:
    async def test_two_rows_on_one_date_link_their_own_actual(
        self, client, test_user, db_session
    ):
        """A ride and a lift on one date must not cross-link."""
        shared = TODAY
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {
                    "day_date": shared,
                    "sport": "cycle",
                    "planned_type": "moderate",
                    "planned_duration_min": 60,
                },
                {
                    "day_date": shared,
                    "sport": "strength",
                    "planned_type": "moderate",
                    "planned_focus": "squat",
                },
            ],
        )
        activity = await _make_activity(db_session, test_user, shared)
        session = await _make_lifting(db_session, test_user, shared)

        resp = await client.post(f"/api/v1/training-plans/{plan.id}/link-activities")
        assert resp.status_code == 200
        assert resp.json()["linked"] == 2

        rows = await _rows_on(db_session, plan, shared)
        by_sport = {r.sport: r for r in rows}
        assert by_sport["cycle"].activity_id == activity.id
        assert by_sport["cycle"].lifting_session_id is None
        assert by_sport["strength"].lifting_session_id == session.id
        assert by_sport["strength"].activity_id is None


# ── The full-array upsert keys on the pair ──────────────────────────────────


class TestSavePlanDays:
    async def test_payload_for_one_sport_leaves_the_other_row_alone(
        self, client, test_user, db_session
    ):
        """A full-array save naming one sport must not delete the other's row."""
        shared = TODAY + timedelta(days=2)
        other = TODAY + timedelta(days=3)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": shared, "sport": "cycle", "planned_type": "easy"},
                {"day_date": shared, "sport": "strength", "planned_type": "moderate"},
                {"day_date": other, "sport": "cycle", "planned_type": "easy"},
            ],
        )

        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}",
            json={
                "days": [
                    {
                        "day_date": shared.isoformat(),
                        "sport": "strength",
                        "planned_type": "hard",
                    }
                ]
            },
        )
        assert resp.status_code == 200

        rows = await _rows_on(db_session, plan, shared)
        assert [(r.sport, r.planned_type) for r in rows] == [("strength", "hard")]

    async def test_duplicate_pair_in_the_payload_is_refused(
        self, client, test_user, db_session
    ):
        plan = await _make_plan(
            db_session,
            test_user,
            [{"day_date": TODAY + timedelta(days=2), "sport": "cycle", "planned_type": "easy"}],
        )
        shared = (TODAY + timedelta(days=2)).isoformat()

        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}",
            json={
                "days": [
                    {"day_date": shared, "sport": "cycle", "planned_type": "easy"},
                    {"day_date": shared, "sport": "cycle", "planned_type": "hard"},
                ]
            },
        )
        assert resp.status_code == 400

    async def test_rest_beside_a_session_in_the_payload_is_refused(
        self, client, test_user, db_session
    ):
        """The upsert writes every pair the payload names, so the payload-level
        validation has to carry the same date rule the targeted guards do."""
        day = TODAY + timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [{"day_date": day, "sport": "cycle", "planned_type": "easy"}],
        )

        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}",
            json={
                "days": [
                    {"day_date": day.isoformat(), "sport": "cycle", "planned_type": "easy"},
                    {"day_date": day.isoformat(), "sport": "rest", "planned_type": "rest"},
                ]
            },
        )
        assert resp.status_code == 400
        assert [
            (r.sport, r.planned_type) for r in await _rows_on(db_session, plan, day)
        ] == [("cycle", "easy")]


# ── Undo restores alongside the other sport ─────────────────────────────────


class TestUndoOnASharedDate:
    async def test_undo_restores_a_deleted_session_beside_the_other_sport(
        self, client, test_user, db_session
    ):
        """Deleting one of two same-date sessions and undoing must not be refused."""
        shared = TODAY + timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": shared, "sport": "cycle", "planned_type": "easy"},
                {"day_date": shared, "sport": "strength", "planned_type": "moderate"},
            ],
        )
        ride = next(d for d in plan.days if d.sport == "cycle")

        resp = await client.delete(
            f"/api/v1/training-plans/{plan.id}/days/{ride.id}"
        )
        assert resp.status_code == 204

        claims = (await client.get("/api/v1/undo")).json()
        claim = next((c for c in claims if c["kind"] == "plan_day_delete"), None)
        assert claim is not None, claims

        resp = await client.post(f"/api/v1/undo/{claim['id']}")
        assert resp.status_code == 200
        assert resp.json()["undone"] is True

        assert sorted(r.sport for r in await _rows_on(db_session, plan, shared)) == [
            "cycle",
            "strength",
        ]


# ── A sport change respects the same rule ───────────────────────────────────
#
# The day-editor PATCH and the missed-session substitute both change an existing
# row's sport in place, which is the one way to break the rule without moving a
# row. Both must consult the same date rule as add / copy / reschedule.


class TestSportChangeOnASharedDate:
    async def test_patch_to_the_sibling_sport_returns_409(
        self, client, test_user, db_session
    ):
        shared = TODAY + timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": shared, "sport": "cycle", "planned_type": "easy"},
                {"day_date": shared, "sport": "strength", "planned_type": "moderate"},
            ],
        )
        lift = next(d for d in plan.days if d.sport == "strength")

        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}/days/{lift.id}",
            json={"sport": "cycle"},
        )
        assert resp.status_code == 409
        assert "cycle" in resp.json()["detail"]
        assert sorted(r.sport for r in await _rows_on(db_session, plan, shared)) == [
            "cycle",
            "strength",
        ]

    async def test_patch_to_rest_beside_a_session_returns_409(
        self, client, test_user, db_session
    ):
        shared = TODAY + timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": shared, "sport": "cycle", "planned_type": "easy"},
                {"day_date": shared, "sport": "strength", "planned_type": "moderate"},
            ],
        )
        lift = next(d for d in plan.days if d.sport == "strength")

        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}/days/{lift.id}",
            json={"sport": "rest", "planned_type": "rest"},
        )
        assert resp.status_code == 409
        assert sorted(r.sport for r in await _rows_on(db_session, plan, shared)) == [
            "cycle",
            "strength",
        ]

    async def test_patch_off_rest_onto_the_sessions_sport_returns_409(
        self, client, test_user, db_session
    ):
        """The reverse direction: a rest row may not take the other row's sport."""
        shared = TODAY + timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": shared, "sport": "rest", "planned_type": "rest"},
                {"day_date": shared, "sport": "cycle", "planned_type": "easy"},
            ],
        )
        rest = next(d for d in plan.days if d.sport == "rest")

        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}/days/{rest.id}",
            json={"sport": "cycle", "planned_type": "easy"},
        )
        assert resp.status_code == 409
        assert "cycle" in resp.json()["detail"]
        assert sorted(r.sport for r in await _rows_on(db_session, plan, shared)) == [
            "cycle",
            "rest",
        ]

    async def test_patch_to_a_sport_that_conflicts_with_nothing_succeeds(
        self, client, test_user, db_session
    ):
        shared = TODAY + timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": shared, "sport": "cycle", "planned_type": "easy"},
                {
                    "day_date": TODAY + timedelta(days=3),
                    "sport": "strength",
                    "planned_type": "moderate",
                },
            ],
        )
        ride = next(d for d in plan.days if d.day_date == shared)

        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}/days/{ride.id}",
            json={"sport": "strength", "planned_tss": 70.0},
        )
        assert resp.status_code == 200
        assert resp.json()["sport"] == "strength"

        rows = await _rows_on(db_session, plan, shared)
        assert [(r.sport, r.planned_tss) for r in rows] == [("strength", 70.0)]

    async def test_substitute_to_the_sibling_sport_returns_409(
        self, client, test_user, db_session
    ):
        shared = TODAY + timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": shared, "sport": "cycle", "planned_type": "easy"},
                {"day_date": shared, "sport": "strength", "planned_type": "moderate"},
            ],
        )
        lift = next(d for d in plan.days if d.sport == "strength")

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{lift.id}/substitute",
            json={"sport": "cycle", "planned_type": "easy"},
        )
        assert resp.status_code == 409
        assert sorted(r.sport for r in await _rows_on(db_session, plan, shared)) == [
            "cycle",
            "strength",
        ]

    async def test_substitute_to_rest_beside_a_session_returns_409(
        self, client, test_user, db_session
    ):
        shared = TODAY + timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": shared, "sport": "cycle", "planned_type": "easy"},
                {"day_date": shared, "sport": "strength", "planned_type": "moderate"},
            ],
        )
        lift = next(d for d in plan.days if d.sport == "strength")

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{lift.id}/substitute",
            json={"sport": "rest", "planned_type": "rest"},
        )
        assert resp.status_code == 409
        assert len(await _rows_on(db_session, plan, shared)) == 2

    async def test_substitute_to_a_sport_that_conflicts_with_nothing_succeeds(
        self, client, test_user, db_session
    ):
        shared = TODAY + timedelta(days=2)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                {"day_date": shared, "sport": "cycle", "planned_type": "hard"},
                {
                    "day_date": TODAY + timedelta(days=3),
                    "sport": "strength",
                    "planned_type": "moderate",
                },
            ],
        )
        ride = next(d for d in plan.days if d.day_date == shared)

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/days/{ride.id}/substitute",
            json={"sport": "strength", "planned_type": "moderate"},
        )
        assert resp.status_code == 200
        assert resp.json()["sport"] == "strength"

        rows = await _rows_on(db_session, plan, shared)
        assert [(r.sport, r.planned_type) for r in rows] == [("strength", "moderate")]
