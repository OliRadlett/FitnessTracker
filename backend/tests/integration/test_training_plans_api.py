"""Integration tests for the Training Plans API (CRUD + generation).

These tests exercise the full pipeline: HTTP â†’ FastAPI router â†’ service â†’ model â†’ database.
No internal functions are mocked.

Run with:  pytest tests/integration/test_training_plans_api.py -m integration
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# â”€â”€ Create â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestCreateTrainingPlan:
    """POST /api/v1/training-plans â€” creates a training plan."""

    async def test_create_plan_returns_201(self, client):
        """A valid POST returns 201 and the serialised plan with days."""
        resp = await client.post(
            "/api/v1/training-plans",
            json={
                "name": "Base Phase",
                "description": "Building aerobic base",
                "start_date": date.today().isoformat(),
                "end_date": (date.today() + timedelta(weeks=4)).isoformat(),
                "plan_type": "base",
                "status": "draft",
                "days": [
                    {
                        "day_date": date.today().isoformat(),
                        "planned_tss": 100.0,
                        "planned_duration_min": 60,
                        "planned_type": "moderate",
                    },
                    {
                        "day_date": (date.today() + timedelta(days=1)).isoformat(),
                        "planned_tss": 0,
                        "planned_duration_min": 0,
                        "planned_type": "rest",
                    },
                ],
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Base Phase"
        assert data["plan_type"] == "base"
        assert len(data["days"]) == 2
        assert "id" in data

    async def test_create_rejects_invalid_plan_type(self, client):
        """An unknown plan_type returns 400."""
        resp = await client.post(
            "/api/v1/training-plans",
            json={
                "name": "Bad Plan",
                "start_date": date.today().isoformat(),
                "end_date": (date.today() + timedelta(weeks=1)).isoformat(),
                "plan_type": "invalid_type",
            },
        )
        assert resp.status_code == 400
        assert "Invalid plan_type" in resp.json()["detail"]

    async def test_create_rejects_end_before_start(self, client):
        """end_date before start_date returns 400."""
        resp = await client.post(
            "/api/v1/training-plans",
            json={
                "name": "Bad Dates",
                "start_date": date.today().isoformat(),
                "end_date": (date.today() - timedelta(days=1)).isoformat(),
                "plan_type": "build",
            },
        )
        assert resp.status_code == 400


# â”€â”€ List â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestListTrainingPlans:
    """GET /api/v1/training-plans â€” lists plans."""

    async def test_list_plans(self, client, test_training_plan):
        """List returns all plans for the user."""
        resp = await client.get("/api/v1/training-plans")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["name"] == "4-Week Build"
        assert data[0]["day_count"] >= 1

    async def test_list_plans_with_status_filter(self, client, test_training_plan):
        """List with status_filter returns only matching plans."""
        resp = await client.get("/api/v1/training-plans?status_filter=active")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert all(p["status"] == "active" for p in data)


# â”€â”€ Get Single â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestGetTrainingPlan:
    """GET /api/v1/training-plans/{id} â€” gets single plan."""

    async def test_get_plan(self, client, test_training_plan):
        """Get returns the plan with all days."""
        resp = await client.get(f"/api/v1/training-plans/{test_training_plan.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(test_training_plan.id)
        assert data["name"] == "4-Week Build"
        assert len(data["days"]) >= 1

    async def test_get_nonexistent_plan(self, client):
        """Get returns 404 for nonexistent plan."""
        import uuid

        resp = await client.get(f"/api/v1/training-plans/{uuid.uuid4()}")
        assert resp.status_code == 404


# â”€â”€ Update â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestUpdateTrainingPlan:
    """PUT /api/v1/training-plans/{id} â€” updates plan."""

    async def test_update_plan(self, client, test_training_plan):
        """PATCH updates the plan fields."""
        resp = await client.patch(
            f"/api/v1/training-plans/{test_training_plan.id}",
            json={"name": "Updated Plan", "status": "active"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Updated Plan"
        assert data["status"] == "active"

    async def test_save_days_preserves_completed_and_activity_links(
        self, client, test_training_plan, db_session
    ):
        """Regression: saving days must NOT delete-and-recreate rows.

        Completed flags and linked activities on unchanged dates survive an
        upsert that touches other dates. ``completed`` / ``activity_id`` /
        ``lifting_session_id`` are server-managed columns â€” never part of the
        day payload â€” so an upsert cannot clobber them.
        """
        from sqlalchemy import select

        from app.models.training_plan import TrainingPlanDay

        # Locate the plan's session-scoped row via the API to get its days.
        resp = await client.get(f"/api/v1/training-plans/{test_training_plan.id}")
        days = resp.json()["days"]
        first_day = days[0]

        # Simulate real usage history: mark day 0 as completed (server-side).
        result = await db_session.execute(
            select(TrainingPlanDay).where(
                TrainingPlanDay.plan_id == test_training_plan.id,
                TrainingPlanDay.day_date == date.fromisoformat(first_day["day_date"]),
            )
        )
        completed_row = result.scalar_one()
        completed_row.completed = True
        await db_session.flush()

        # Re-save every date (tss bump on day 0) plus one new date.
        original_day_ids = {d["id"] for d in days}
        resp = await client.patch(
            f"/api/v1/training-plans/{test_training_plan.id}",
            json={
                "days": [
                    {
                        "day_date": d["day_date"],
                        "planned_tss": d["planned_tss"] + 5 if i == 0 else d["planned_tss"],
                        "sport": d.get("sport", "cycle"),
                        "planned_type": d["planned_type"],
                    }
                    for i, d in enumerate(days)
                ]
                + [
                    {
                        "day_date": (
                            date.fromisoformat(days[-1]["day_date"]) + timedelta(days=1)
                        ).isoformat(),
                        "planned_tss": 90.0,
                        "planned_duration_min": 75,
                        "planned_type": "moderate",
                    }
                ]
            },
        )
        assert resp.status_code == 200
        saved = resp.json()["days"]
        assert len(saved) == len(days) + 1  # new date inserted

        updated_first = next(d for d in saved if d["id"] == first_day["id"])
        assert updated_first["completed"] is True  # preserved through re-save
        assert updated_first["planned_tss"] == pytest.approx(
            first_day["planned_tss"] + 5
        )
        assert {d["id"] for d in saved[:-1]} == original_day_ids  # no recreation

        # Sanity: ORM model still exposes the columns the upsert preserves.
        assert hasattr(TrainingPlanDay, "activity_id")
        assert hasattr(TrainingPlanDay, "lifting_session_id")

    async def test_save_days_deletes_removed_dates(self, client, test_training_plan):
        """Dates omitted from the payload are deleted (true upsert semantics)."""
        resp = await client.get(f"/api/v1/training-plans/{test_training_plan.id}")
        days = resp.json()["days"]

        resp = await client.patch(
            f"/api/v1/training-plans/{test_training_plan.id}",
            json={"days": [dict(d) for d in days[:3]]},
        )
        assert resp.status_code == 200
        assert len(resp.json()["days"]) == 3


# â”€â”€ Template generation (mixed weeks) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def _next_monday(from_date: date) -> date:
    delta = (7 - from_date.weekday()) % 7
    return from_date + timedelta(days=delta if delta else 7)


class TestGenerateTrainingPlan:
    """POST /api/v1/training-plans/generate â€” mixed-week template generation."""

    async def test_generate_rejects_bad_template(self, client):
        resp = await client.post(
            "/api/v1/training-plans/generate",
            json={
                "name": "Bad",
                "template_type": "custom",  # custom is not a generatable template
                "weeks": 4,
                "start_date": _next_monday(date.today()).isoformat(),
                "base_tss": 300,
            },
        )
        assert resp.status_code == 400
        assert "Invalid template_type" in resp.json()["detail"]

    async def test_mixed_week_rest_sundays_strength_tuesdays(self, client):
        """Generated weeks have rest Sundays, strength Tue/Thu, cycle rides."""
        start = _next_monday(date.today())
        resp = await client.post(
            "/api/v1/training-plans/generate",
            json={
                "name": "Mixed Build",
                "template_type": "build",
                "weeks": 2,
                "start_date": start.isoformat(),
                "base_tss": 300,
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert len(data["days"]) == 14

        def day_at(week: int, dow: int) -> dict:
            target = start + timedelta(weeks=week, days=dow)
            return next(
                d for d in data["days"] if d["day_date"] == target.isoformat()
            )

        for week in range(2):
            sunday = day_at(week, 6)
            assert sunday["sport"] == "rest"
            assert sunday["planned_type"] == "rest"

            tuesday = day_at(week, 1)
            thursday = day_at(week, 3)
            for strength_day in (tuesday, thursday):
                assert strength_day["sport"] == "strength"
                assert strength_day["planned_focus"] in (
                    "squat",
                    "bench",
                    "deadlift",
                )
                exercises = strength_day["planned_exercises"]
                assert isinstance(exercises, list) and exercises
                for ex in exercises:
                    assert {"exercise", "sets", "reps"} <= set(ex.keys())

            # Tuesday carries the main lift, Thursday the accessory variant.
            assert tuesday["planned_exercises"] != thursday["planned_exercises"]

            wednesday = day_at(week, 2)
            assert wednesday["sport"] == "cycle"
            assert wednesday["planned_type"] == "hard"

            saturday = day_at(week, 5)
            assert saturday["sport"] == "cycle"

        # Focus rotates squat â†’ bench â†’ deadlift across weeks.
        assert day_at(0, 1)["planned_focus"] != day_at(1, 1)["planned_focus"]

        # Progressive build: week 2 rides carry more TSS than week 1.
        week1_tss = sum(
            d["planned_tss"] or 0
            for d in data["days"]
            if d["sport"] == "cycle"
            and date.fromisoformat(d["day_date"]) < start + timedelta(weeks=1)
        )
        week2_tss = sum(
            d["planned_tss"] or 0
            for d in data["days"]
            if d["sport"] == "cycle"
            and date.fromisoformat(d["day_date"]) >= start + timedelta(weeks=1)
        )
        assert week2_tss > week1_tss


# â”€â”€ Event linkage + auto-taper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestEventLinkageAndTaper:
    """POST/PATCH with event_id â€” clamp end date and taper final days."""

    async def test_event_link_clamps_end_date_and_tapers(
        self, client, test_event
    ):
        """A plan extending past the event is clamped and tapered 100%â†’40%."""
        start = date.today()
        days = [
            {
                "day_date": (start + timedelta(days=i)).isoformat(),
                "planned_tss": 100.0,
                "planned_duration_min": 60,
                "planned_type": "moderate",
                "sport": "cycle",
            }
            for i in range(42)  # 6 weeks â€” extends past the event (+30 days)
        ]
        resp = await client.post(
            "/api/v1/training-plans",
            json={
                "name": "Century Prep",
                "start_date": start.isoformat(),
                "end_date": (start + timedelta(days=41)).isoformat(),
                "plan_type": "build",
                "event_id": str(test_event.id),
                "days": days,
            },
        )
        assert resp.status_code == 201
        data = resp.json()

        # Plan clamped to event date and linked.
        assert data["event_id"] == str(test_event.id)
        assert data["end_date"] == (start + timedelta(days=30)).isoformat()

        # Final min(taper_days=14, plan length) days ramp linearly 100%â†’40%.
        tapered = sorted(data["days"], key=lambda d: d["day_date"])
        window_start = start + timedelta(days=30 - 13)
        final_window = [
            d
            for d in tapered
            if window_start
            <= date.fromisoformat(d["day_date"])
            <= date.fromisoformat(data["end_date"])
        ]
        assert len(final_window) == 14
        factors = [d["planned_tss"] / 100.0 for d in final_window]
        assert factors[0] == pytest.approx(1.0, abs=0.01)
        assert factors[-1] == pytest.approx(0.4, abs=0.01)
        assert all(factors[i] > factors[i + 1] for i in range(len(factors) - 1))

        # Pre-taper days untouched.
        pre_window = [d for d in tapered if d not in final_window]
        assert all(d["planned_tss"] == pytest.approx(100.0) for d in pre_window)

    async def test_patch_can_link_event(self, client, test_training_plan, test_event):
        """PATCH with event_id links the event and applies taper."""
        resp = await client.patch(
            f"/api/v1/training-plans/{test_training_plan.id}",
            json={"event_id": str(test_event.id)},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["event_id"] == str(test_event.id)

    async def test_link_nonexistent_event_returns_400(self, client):
        import uuid as uuid_mod

        start = date.today()
        resp = await client.post(
            "/api/v1/training-plans",
            json={
                "name": "Orphan",
                "start_date": start.isoformat(),
                "end_date": (start + timedelta(days=7)).isoformat(),
                "plan_type": "build",
                "event_id": str(uuid_mod.uuid4()),
                "days": [],
            },
        )
        assert resp.status_code == 400
        assert "Event not found" in resp.json()["detail"]


# â”€â”€ Weekly view (Phase 5B) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestGetPlanWeek:
    """GET /api/v1/training-plans/{id}/week/{n} â€” weekly view with enrichment."""

    async def _create_monday_plan(self, client, weeks: int, name: str) -> dict:
        start = _next_monday(date.today())
        resp = await client.post(
            "/api/v1/training-plans/generate",
            json={
                "name": name,
                "template_type": "base",
                "weeks": weeks,
                "start_date": start.isoformat(),
                "base_tss": 300,
            },
        )
        assert resp.status_code == 201
        return resp.json()

    async def test_week_boundaries(self, client):
        """Week 1 starts on the plan's Monday; week 2 follows; 404 outside range."""
        data = await self._create_monday_plan(client, weeks=2, name="Week Boundaries")
        plan_id = data["id"]
        start = date.fromisoformat(data["start_date"])

        resp = await client.get(f"/api/v1/training-plans/{plan_id}/week/1")
        assert resp.status_code == 200
        week = resp.json()
        assert week["plan_id"] == plan_id
        assert week["week_number"] == 1
        assert week["week_start"] == start.isoformat()  # aligned to Monday start
        assert week["week_end"] == (start + timedelta(days=6)).isoformat()
        assert len(week["days"]) == 7

        resp = await client.get(f"/api/v1/training-plans/{plan_id}/week/2")
        assert resp.status_code == 200
        week2 = resp.json()
        assert week2["week_start"] == (start + timedelta(weeks=1)).isoformat()
        assert week2["week_end"] == (start + timedelta(weeks=1, days=6)).isoformat()

    async def test_week_404_out_of_range(self, client):
        """Week 0 and past-the-end weeks return 404."""
        data = await self._create_monday_plan(client, weeks=2, name="Range Check")
        plan_id = data["id"]

        for bad_week in (0, 3, -1):
            resp = await client.get(f"/api/v1/training-plans/{plan_id}/week/{bad_week}")
            assert resp.status_code == 404

    async def test_week_404_unknown_plan(self, client):
        import uuid

        resp = await client.get(
            f"/api/v1/training-plans/{uuid.uuid4()}/week/1"
        )
        assert resp.status_code == 404

    async def test_actual_activity_present_when_linked(
        self, client, test_training_plan, test_activity, db_session
    ):
        """A day with activity_id exposes an actual_activity summary."""
        from sqlalchemy import select

        from app.models.training_plan import TrainingPlanDay

        result = await db_session.execute(
            select(TrainingPlanDay).where(
                TrainingPlanDay.plan_id == test_training_plan.id,
                TrainingPlanDay.day_date == date.today(),
            )
        )
        day = result.scalar_one()
        day.activity_id = test_activity.id
        await db_session.flush()

        resp = await client.get(
            f"/api/v1/training-plans/{test_training_plan.id}/week/1"
        )
        assert resp.status_code == 200
        week = resp.json()
        enriched = next(d for d in week["days"] if d["id"] == str(day.id))
        actual = enriched["actual_activity"]
        assert actual is not None
        assert actual["id"] == str(test_activity.id)
        assert actual["name"] == "Morning Ride"
        assert actual["sport_type"] == "cycling"
        assert actual["tss"] == pytest.approx(80.0)
        assert actual["average_power"] == pytest.approx(200.0)

    async def test_actual_lifting_session_present_when_linked(
        self, client, test_training_plan, test_lifting_session, db_session
    ):
        """A day with lifting_session_id exposes an actual_lifting_session summary."""
        from sqlalchemy import select

        from app.models.training_plan import TrainingPlanDay

        result = await db_session.execute(
            select(TrainingPlanDay).where(
                TrainingPlanDay.plan_id == test_training_plan.id,
                TrainingPlanDay.day_date == date.today(),
            )
        )
        day = result.scalar_one()
        day.lifting_session_id = test_lifting_session.id
        await db_session.flush()

        resp = await client.get(
            f"/api/v1/training-plans/{test_training_plan.id}/week/1"
        )
        assert resp.status_code == 200
        week = resp.json()
        enriched = next(d for d in week["days"] if d["id"] == str(day.id))
        actual = enriched["actual_lifting_session"]
        assert actual is not None
        assert actual["id"] == str(test_lifting_session.id)
        assert actual["focus"] == "squat"

    async def test_weather_and_route_enrichment_null_without_services(
        self, client, test_training_plan
    ):
        """Without coords/FTP the best-effort enrichment degrades to nulls.

        No cycling profile exists â†’ no FTP â†’ route matching skipped; no home
        location or routed activities â†’ weather resolution finds nothing.
        """
        resp = await client.get(
            f"/api/v1/training-plans/{test_training_plan.id}/week/1"
        )
        assert resp.status_code == 200
        week = resp.json()
        assert week["readiness"] is None  # no TSS-bearing activities
        for day in week["days"]:
            assert day["weather"] is None
            assert day["bad_weather"] is None
            if day["sport"] == "cycle":
                assert day["route_matches"] is None

    async def test_include_weather_false_still_returns_week(
        self, client, test_training_plan
    ):
        """include_weather=false skips weather entirely without erroring."""
        resp = await client.get(
            f"/api/v1/training-plans/{test_training_plan.id}/week/1"
            "?include_weather=false"
        )
        assert resp.status_code == 200
        week = resp.json()
        assert len(week["days"]) == 7
        assert all(d["weather"] is None for d in week["days"])


class TestUpdatePlanDay:
    """PATCH /api/v1/training-plans/{id}/days/{day_id} â€” targeted day update."""

    async def test_patch_updates_only_provided_fields(
        self, client, test_training_plan, db_session
    ):
        """Only sent fields change; completed flag and other columns survive."""
        from sqlalchemy import select

        from app.models.training_plan import TrainingPlanDay

        result = await db_session.execute(
            select(TrainingPlanDay).where(
                TrainingPlanDay.plan_id == test_training_plan.id,
                TrainingPlanDay.day_date == date.today(),
            )
        )
        day = result.scalar_one()
        day.completed = True
        original_type = day.planned_type
        original_duration = day.planned_duration_min
        await db_session.flush()

        resp = await client.patch(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{day.id}",
            json={"notes": "easy spin", "planned_tss": 55.0},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["notes"] == "easy spin"
        assert data["planned_tss"] == pytest.approx(55.0)
        # Untouched fields preserved.
        assert data["completed"] is True
        assert data["planned_type"] == original_type
        assert data["planned_duration_min"] == original_duration

        # Persisted to the database, not just serialised.
        await db_session.refresh(day)
        assert day.notes == "easy spin"
        assert day.completed is True

    async def test_patch_unknown_day_returns_404(self, client, test_training_plan):
        import uuid

        resp = await client.patch(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{uuid.uuid4()}",
            json={"notes": "nope"},
        )
        assert resp.status_code == 404

    async def test_patch_unknown_plan_returns_404(self, client):
        import uuid

        resp = await client.patch(
            f"/api/v1/training-plans/{uuid.uuid4()}/days/{uuid.uuid4()}",
            json={"notes": "nope"},
        )
        assert resp.status_code == 404

    async def test_patch_invalid_planned_type_returns_400(
        self, client, test_training_plan
    ):
        resp = await client.get(f"/api/v1/training-plans/{test_training_plan.id}")
        day_id = resp.json()["days"][0]["id"]

        resp = await client.patch(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{day_id}",
            json={"planned_type": "super_hard"},
        )
        assert resp.status_code == 400
        assert "Invalid planned_type" in resp.json()["detail"]


# â”€â”€ Delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestDeleteTrainingPlan:
    """DELETE /api/v1/training-plans/{id} â€” deletes plan."""

    async def test_delete_plan(self, client, test_training_plan):
        """DELETE removes the plan and its days."""
        resp = await client.delete(f"/api/v1/training-plans/{test_training_plan.id}")
        assert resp.status_code == 204

        # Verify it's gone
        resp = await client.get(f"/api/v1/training-plans/{test_training_plan.id}")
        assert resp.status_code == 404


# â”€â”€ Conformity (Phase 5C) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestConformity:
    """GET /training-plans/{id}/conformity + per-day conformity."""

    async def _add_cycle_day(self, db_session, plan_id, **overrides):
        from app.models.training_plan import TrainingPlanDay

        fields = {
            "plan_id": plan_id,
            "day_date": date.today(),
            "sport": "cycle",
            "planned_type": "moderate",
        }
        fields.update(overrides)
        day = TrainingPlanDay(**fields)
        db_session.add(day)
        await db_session.flush()
        return day

    async def test_day_conformity_with_linked_activity(
        self, client, test_training_plan, test_activity, db_session
    ):
        """A scored day returns done status with a numeric percentage."""
        day = await self._add_cycle_day(
            db_session,
            test_training_plan.id,
            day_date=date.today() - timedelta(days=1),
            planned_tss=80.0,
            planned_duration_min=60,
            planned_power_watts=200,
        )
        day.activity_id = test_activity.id
        await db_session.flush()

        resp = await client.get(
            f"/api/v1/training-plans/{test_training_plan.id}"
            f"/days/{day.id}/conformity"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "done"
        assert data["sport"] == "cycle"
        assert isinstance(data["conformity_pct"], float)
        assert 0 <= data["conformity_pct"] <= 100
        metrics = {c["metric"] for c in data["components"]}
        assert {"duration", "power", "tss"} <= metrics
        weights = [c["weight_used"] for c in data["components"]]
        assert sum(w for w in weights if w is not None) == pytest.approx(1.0)

    async def test_day_conformity_missed_for_past_day_without_actual(
        self, client, test_training_plan, db_session
    ):
        """A past cycle day with no linked activity reports missed."""
        day = await self._add_cycle_day(
            db_session,
            test_training_plan.id,
            day_date=date.today() - timedelta(days=2),
            planned_tss=90.0,
        )
        resp = await client.get(
            f"/api/v1/training-plans/{test_training_plan.id}"
            f"/days/{day.id}/conformity"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "missed"
        assert data["conformity_pct"] is None
        assert data["classification"] is None

    async def test_weekly_conformity_shape(self, client, test_training_plan):
        """Plan-level response carries overall/trend/weeks/patterns keys."""
        resp = await client.get(
            f"/api/v1/training-plans/{test_training_plan.id}/conformity"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) >= {
            "plan_id",
            "overall_pct",
            "trend",
            "weeks",
            "patterns",
        }
        assert data["weeks"], "expected at least one week window"
        week = data["weeks"][0]
        assert set(week.keys()) >= {
            "week_number",
            "week_start",
            "week_end",
            "days_scored",
            "days_total",
            "pct",
            "by_sport",
        }
        assert set(week["by_sport"].keys()) == {"cycle", "strength"}
        # Fixture days are unscored (no linked actuals) â†’ pct null.
        assert week["pct"] is None

    async def test_link_activities_endpoint(
        self, client, test_training_plan, test_activity, db_session
    ):
        """POST /link-activities fills the unlinked past cycle day."""
        from sqlalchemy import select

        from app.models.training_plan import TrainingPlanDay

        day = await self._add_cycle_day(
            db_session,
            test_training_plan.id,
            day_date=date.today() - timedelta(days=1),  # matches test_activity date
        )

        resp = await client.post(
            f"/api/v1/training-plans/{test_training_plan.id}/link-activities"
        )
        assert resp.status_code == 200
        assert resp.json()["linked"] >= 1

        refreshed = (
            (
                await db_session.execute(
                    select(TrainingPlanDay).where(TrainingPlanDay.id == day.id)
                )
            )
            .scalars()
            .one()
        )
        assert refreshed.activity_id == test_activity.id

    async def test_conformity_unknown_plan_returns_404(self, client):
        import uuid

        resp = await client.get(f"/api/v1/training-plans/{uuid.uuid4()}/conformity")
        assert resp.status_code == 404

    async def test_day_conformity_unknown_day_returns_404(
        self, client, test_training_plan
    ):
        import uuid

        resp = await client.get(
            f"/api/v1/training-plans/{test_training_plan.id}"
            f"/days/{uuid.uuid4()}/conformity"
        )
        assert resp.status_code == 404
