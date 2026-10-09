"""P2 goal improvements — integration tests (real Postgres, run in CI).

Covers: personalised GET /goals/templates, deload-week exclusion in the
goal projection regression. Requires DATABASE_URL (host-side runs fail
without a reachable Postgres — see AGENTS.md pitfall 23).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

pytestmark = pytest.mark.integration


def _monday(n_weeks_ago: int) -> date:
    """Monday of the week *n_weeks_ago* before this week."""
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    return monday - timedelta(weeks=n_weeks_ago)


async def test_templates_personalised_from_prs_and_weigh_in(
    client, test_personal_record, test_weight_log
):
    """Squat 180 kg @ 75.5 kg → 200 kg plate, 2.5×BW elite, 400 club."""
    r = await client.get("/api/v1/goals/templates")
    assert r.status_code == 200
    body = r.json()
    assert body["bodyweight_kg"] == 75.5

    by_key = {t["key"]: t for t in body["templates"]}
    # Plate milestone above the 180 kg squat PR
    assert by_key["plate_back_squat"]["suggested_target"] == 200.0
    assert by_key["plate_back_squat"]["current_value"] == 180.0
    assert by_key["plate_back_squat"]["metric"] == "estimated_1rm"
    assert by_key["plate_back_squat"]["filter_json"] == {"exercise": "Back Squat"}
    # BW standard: 180/75.5 = 2.38× → advanced → next is elite 2.5×
    assert by_key["standard_back_squat"]["suggested_target"] == 2.5
    assert by_key["standard_back_squat"]["metric"] == "squat_bw_ratio"
    # Big-3 total is 180 (squat only) → 400 club
    assert by_key["big3_total_club"]["suggested_target"] == 400.0
    # Lifts with no data get entry-level starters
    assert by_key["plate_bench_press"]["suggested_target"] == 60.0
    assert by_key["plate_bench_press"]["current_value"] is None
    assert by_key["plate_deadlift"]["suggested_target"] == 140.0

    # Every template's create_payload posts cleanly to POST /goals
    create = await client.post(
        "/api/v1/goals", json=by_key["plate_back_squat"]["create_payload"]
    )
    assert create.status_code == 201
    assert create.json()["target_value"] == 200.0


async def test_projection_skips_deload_week_check_ins(client, db_session, test_user):
    """A depressed deload-week check-in is excluded from the fitted trend."""
    from app.models.activity import Activity
    from app.models.goal import Goal, GoalCheckIn

    # 5 trained weeks (300 TSS) then a deload week (50 TSS).
    for weeks_ago, tss in [
        (9, 300.0),
        (8, 300.0),
        (7, 300.0),
        (6, 300.0),
        (5, 300.0),
        (4, 50.0),
    ]:
        day = _monday(weeks_ago) + timedelta(days=2)  # Wednesday
        db_session.add(
            Activity(
                user_id=test_user.id,
                source="strava",
                sport_type="cycling",
                name=f"Load {weeks_ago}",
                start_date=datetime(day.year, day.month, day.day, 12, 0, tzinfo=UTC),
                duration_seconds=3600,
                tss=tss,
                provider_activity_id=f"deload_{weeks_ago}",
            )
        )
    await db_session.flush()

    goal = Goal(
        user_id=test_user.id,
        metric="body_weight",
        target_value=70.0,
        status="active",
    )
    db_session.add(goal)
    await db_session.flush()

    # 6 weekly check-ins, one per week 6..1 — the deload week (4 ago) reads low.
    values = {6: 76.0, 5: 75.6, 4: 74.0, 3: 75.2, 2: 74.8, 1: 74.4}
    for weeks_ago, value in values.items():
        db_session.add(
            GoalCheckIn(
                user_id=test_user.id,
                goal_id=goal.id,
                check_in_date=_monday(weeks_ago),
                value=value,
                source="auto",
            )
        )
    await db_session.flush()

    r = await client.get(f"/api/v1/projections/goal/{goal.id}")
    assert r.status_code == 200
    trend = r.json()["trend"]
    assert trend is not None
    assert trend["deload_weeks_skipped"] == 1
    assert trend["data_points"] == 5
    # History still shows all six check-ins — only the fit skips the week.
    assert len(r.json()["history"]) == 6
