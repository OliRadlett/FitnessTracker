"""Integration tests for the training-plan editor primitives.

Covers the targeted single-day operations added for the training-page editor:
add a day (``POST /{id}/days``), delete a day (``DELETE /{id}/days/{day}``) and
swap two days (``POST /{id}/days/{day}/swap``). These are the non-destructive
counterparts to the full-array ``PATCH /{id}``.

Run with:  pytest tests/integration/test_training_plan_editor.py -m integration
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models.training_plan import TrainingPlanDay

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── Add day ─────────────────────────────────────────────────────────────────


class TestAddPlanDay:
    """POST /training-plans/{id}/days — add one day."""

    async def test_add_day_returns_201(self, client, test_training_plan):
        """A free date within range inserts one day (server defaults applied)."""
        free_date = (date.today() + timedelta(days=7)).isoformat()
        resp = await client.post(
            f"/api/v1/training-plans/{test_training_plan.id}/days",
            json={"day_date": free_date, "sport": "rest", "planned_type": "rest"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["day_date"] == free_date
        assert data["sport"] == "rest"
        assert data["plan_id"] == str(test_training_plan.id)
        # Server default applied despite the payload omitting ``completed``.
        assert data["completed"] is False

    async def test_add_day_on_existing_date_returns_409(
        self, client, test_training_plan
    ):
        """A date that already holds a day is refused (no silent overwrite)."""
        taken = (date.today()).isoformat()
        resp = await client.post(
            f"/api/v1/training-plans/{test_training_plan.id}/days",
            json={"day_date": taken, "sport": "cycle", "planned_type": "easy"},
        )
        assert resp.status_code == 409

    async def test_add_day_out_of_range_returns_400(self, client, test_training_plan):
        """A date outside the plan's window is a client error."""
        resp = await client.post(
            f"/api/v1/training-plans/{test_training_plan.id}/days",
            json={
                "day_date": (date.today() + timedelta(days=60)).isoformat(),
                "sport": "cycle",
                "planned_type": "easy",
            },
        )
        assert resp.status_code == 400

    async def test_add_day_unknown_plan_returns_404(self, client):
        resp = await client.post(
            f"/api/v1/training-plans/{uuid.uuid4()}/days",
            json={
                "day_date": date.today().isoformat(),
                "sport": "cycle",
                "planned_type": "easy",
            },
        )
        assert resp.status_code == 404


# ── Delete day ──────────────────────────────────────────────────────────────


class TestDeletePlanDay:
    """DELETE /training-plans/{id}/days/{day_id} — delete one day."""

    async def test_delete_removes_the_day(self, client, test_training_plan, db_session):
        target = min(test_training_plan.days, key=lambda d: d.day_date)
        target_id = str(target.id)

        resp = await client.delete(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{target_id}"
        )
        assert resp.status_code == 204

        remaining = (
            (
                await db_session.execute(
                    select(TrainingPlanDay).where(
                        TrainingPlanDay.plan_id == test_training_plan.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert target_id not in {str(d.id) for d in remaining}
        # The plan itself is untouched.
        assert len(remaining) == len(test_training_plan.days) - 1

    async def test_delete_completed_day_returns_400(
        self, client, test_training_plan, db_session
    ):
        target = min(test_training_plan.days, key=lambda d: d.day_date)
        target.completed = True
        await db_session.flush()

        resp = await client.delete(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{target.id}"
        )
        assert resp.status_code == 400
        assert "completed" in resp.json()["detail"]

    async def test_delete_unknown_day_returns_404(self, client, test_training_plan):
        resp = await client.delete(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{uuid.uuid4()}"
        )
        assert resp.status_code == 404


# ── Swap days ───────────────────────────────────────────────────────────────


class TestSwapPlanDays:
    """POST /training-plans/{id}/days/{day_id}/swap — exchange two dates."""

    async def test_swap_exchanges_dates_and_keeps_ids(
        self, client, test_training_plan, db_session
    ):
        days = sorted(test_training_plan.days, key=lambda d: d.day_date)
        first, fourth = days[0], days[3]
        first_date, fourth_date = first.day_date, fourth.day_date
        assert first_date != fourth_date

        resp = await client.post(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{first.id}/swap",
            json={"target_day_id": str(fourth.id)},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        by_id = {b["id"]: b["day_date"] for b in body}
        assert by_id[str(first.id)] == fourth_date.isoformat()
        assert by_id[str(fourth.id)] == first_date.isoformat()

        # Persisted, and the rows are the same rows (no delete/recreate) —
        # this is what proves the swap needs no UNIQUE-date temp trick.
        await db_session.refresh(first)
        await db_session.refresh(fourth)
        assert first.day_date == fourth_date
        assert fourth.day_date == first_date

    async def test_swap_completed_day_returns_400(
        self, client, test_training_plan, db_session
    ):
        days = sorted(test_training_plan.days, key=lambda d: d.day_date)
        first, second = days[0], days[1]
        second.completed = True
        await db_session.flush()

        resp = await client.post(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{first.id}/swap",
            json={"target_day_id": str(second.id)},
        )
        assert resp.status_code == 400
        assert "completed" in resp.json()["detail"]

    async def test_swap_self_returns_400(self, client, test_training_plan):
        day = test_training_plan.days[0]
        resp = await client.post(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{day.id}/swap",
            json={"target_day_id": str(day.id)},
        )
        assert resp.status_code == 400

    async def test_swap_unknown_target_returns_404(self, client, test_training_plan):
        day = test_training_plan.days[0]
        resp = await client.post(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{day.id}/swap",
            json={"target_day_id": str(uuid.uuid4())},
        )
        assert resp.status_code == 404
