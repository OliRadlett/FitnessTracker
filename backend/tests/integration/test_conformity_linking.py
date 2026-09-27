"""Sport matching when auto-linking activities to cycle plan days (SCI-06).

Run with:  pytest tests/integration/test_conformity_linking.py -m integration
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.models.activity import Activity

pytestmark = pytest.mark.integration


def _activity(user_id, day, sport, hour, provider_id) -> Activity:
    return Activity(
        user_id=user_id,
        source="strava",
        sport_type=sport,
        name=sport.title(),
        start_date=datetime(day.year, day.month, day.day, hour, tzinfo=UTC),
        duration_seconds=3600,
        provider_activity_id=provider_id,
    )


class TestCycleDaySportMatching:
    async def test_links_cycling_activity_not_same_day_run(
        self, db_session, test_user, test_training_plan
    ):
        from app.services.conformity import link_activities_to_plan_days

        day = test_training_plan.days[0]
        assert day.sport == "cycle"
        d = day.day_date
        run = _activity(test_user.id, d, "running", 8, "run_1")
        ride = _activity(test_user.id, d, "cycling", 9, "ride_1")
        db_session.add_all([run, ride])
        await db_session.flush()

        await link_activities_to_plan_days(db_session, test_user.id)
        await db_session.refresh(day)

        assert day.activity_id == ride.id
        assert day.completed is True

    async def test_cycle_day_not_linked_to_non_cycling_only(
        self, db_session, test_user, test_training_plan
    ):
        from app.services.conformity import link_activities_to_plan_days

        day = test_training_plan.days[0]
        run = _activity(test_user.id, day.day_date, "running", 8, "run_only")
        db_session.add(run)
        await db_session.flush()

        await link_activities_to_plan_days(db_session, test_user.id)
        await db_session.refresh(day)

        assert day.activity_id is None
