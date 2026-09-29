"""Integration tests for GET /api/v1/nutrition/fuel-plan/activity/{activity_id}.

Regression cover for BUG-068 ("Could not load fuel plan"): the endpoint must
return 200/null when no plan exists and 200 + the serialized plan when one
does — never an unlogged 500.
"""

from __future__ import annotations

import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


async def test_returns_null_when_no_plan(client):
    resp = await client.get(f"/api/v1/nutrition/fuel-plan/activity/{uuid.uuid4()}")
    assert resp.status_code == 200
    assert resp.json() is None


async def test_returns_plan_for_activity(client, db_session, test_user):
    from datetime import UTC, datetime

    from app.models.activity import Activity
    from app.services.nutrition import generate_fuel_plan

    activity = Activity(
        user_id=test_user.id,
        source="manual",
        sport_type="cycling",
        name="Test ride",
        start_date=datetime.now(UTC),
        duration_seconds=7200,
    )
    db_session.add(activity)
    await db_session.flush()

    plan = await generate_fuel_plan(
        db_session,
        test_user.id,
        planned_duration_min=120,
        planned_if=0.75,
    )
    plan.activity_id = activity.id
    await db_session.flush()

    resp = await client.get(f"/api/v1/nutrition/fuel-plan/activity/{activity.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["activity_id"] == str(activity.id)
    assert body["planned_duration_min"] == 120
    assert isinstance(body["schedule"], list)
