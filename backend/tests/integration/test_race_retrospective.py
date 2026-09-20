"""Integration tests for the CD3 race-retrospective wiring.

Exercises ``_build_race_retrospective_args`` (used by the weekly
cross-domain task) directly with a real DB: eligible raced event →
Modal-ready kwargs; dedup when a retrospective already exists.

Run with:  pytest tests/integration/test_race_retrospective.py -m integration
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]

from app.models.activity import Activity
from app.models.cross_domain import CrossDomainInsight
from app.models.event import Event
from app.tasks.scheduler import _build_race_retrospective_args


async def _event(db_session, user_id, days_ago=10, with_result=True):
    event = Event(
        user_id=user_id,
        name="Test Race",
        event_date=date.today() - timedelta(days=days_ago),
        event_type="race",
        target_tss=250.0,
        result={"finishing_time": "1:30:00", "personal_best": True}
        if with_result
        else None,
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def _race_day_activity(db_session, user_id, event_date):
    activity = Activity(
        user_id=user_id,
        source="strava",
        sport_type="cycling",
        name="Race Day",
        start_date=datetime(
            event_date.year, event_date.month, event_date.day, 9, 0, tzinfo=UTC
        ),
        duration_seconds=5400,
        distance_meters=80_000.0,
        elevation_gain_meters=800.0,
        average_power=220.0,
        normalized_power=235.0,
        tss=260.0,
        weather_temperature=18.0,
        weather_wind_speed_kmh=12.0,
        weather_conditions="clear",
        provider_activity_id="race_day_1",
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


class TestBuildRaceRetrospectiveArgs:
    async def test_no_event_returns_empty(self, db_session, test_user):
        kwargs, event_id = await _build_race_retrospective_args(
            db_session, test_user.id
        )
        assert kwargs == {}
        assert event_id is None

    async def test_event_without_result_returns_empty(
        self, db_session, test_user
    ):
        await _event(db_session, test_user.id, with_result=False)
        kwargs, event_id = await _build_race_retrospective_args(
            db_session, test_user.id
        )
        assert kwargs == {}
        assert event_id is None

    async def test_eligible_event_builds_kwargs(self, db_session, test_user):
        event = await _event(db_session, test_user.id, days_ago=10)
        await _race_day_activity(db_session, test_user.id, event.event_date)

        kwargs, event_id = await _build_race_retrospective_args(
            db_session, test_user.id
        )

        assert event_id == str(event.id)
        race_data = kwargs["race_data"]
        assert race_data["actual_tss"] == 260.0
        assert race_data["actual_watts"] == 220.0
        assert race_data["personal_best"] is True
        assert kwargs["pre_race_data"]["target_tss"] == 250.0
        assert kwargs["pre_race_data"]["tsb_projected"] is not None
        assert kwargs["race_weather_data"]["temperature"] == 18.0
        assert isinstance(kwargs["race_training_data"], list)

    async def test_existing_retrospective_dedups(self, db_session, test_user):
        event = await _event(db_session, test_user.id, days_ago=10)
        await _race_day_activity(db_session, test_user.id, event.event_date)
        db_session.add(
            CrossDomainInsight(
                user_id=test_user.id,
                insight_type="race_retrospective",
                results={"event_id": str(event.id), "insights": ["old"]},
                insights=["old"],
                data_quality={},
            )
        )
        await db_session.flush()

        kwargs, event_id = await _build_race_retrospective_args(
            db_session, test_user.id
        )
        assert kwargs == {}
        assert event_id is None
