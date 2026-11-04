"""Whoop respiratory-rate ingestion.

Whoop v2 puts respiratory rate on the sleep score, not the recovery score. The
cycle sync's recovery read is therefore always NULL; the sleep sync is the
writer that must populate ``daily_metrics.respiratory_rate``.
"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.daily_metric import DailyMetric
from app.models.sleep import SleepLog
from app.services.whoop import (
    _sleep_respiratory_rate,
    _upsert_sleep_daily_metric,
    sync_whoop_sleep,
)

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


def test_sleep_respiratory_rate_reads_sleep_score():
    assert _sleep_respiratory_rate({"respiratory_rate": 13.71}) == 13.71
    assert _sleep_respiratory_rate({"respiratory_rate": "14.2"}) == 14.2
    assert _sleep_respiratory_rate({}) is None
    assert _sleep_respiratory_rate({"respiratory_rate": None}) is None
    assert _sleep_respiratory_rate({"respiratory_rate": "not-a-number"}) is None


async def _get_metric(db: AsyncSession, user_id, day: date) -> DailyMetric | None:
    result = await db.execute(
        select(DailyMetric).where(
            DailyMetric.user_id == user_id,
            DailyMetric.metric_date == day,
            DailyMetric.source == "whoop",
        )
    )
    return result.scalar_one_or_none()


class TestSleepDailyMetric:
    async def test_persists_respiratory_rate(self, db_session, test_user):
        day = date(2026, 1, 15)

        await _upsert_sleep_daily_metric(
            db_session,
            test_user.id,
            day,
            7 * 3600 + 30 * 60,
            93.5,
            13.71,
        )
        await db_session.flush()

        metric = await _get_metric(db_session, test_user.id, day)
        assert metric is not None
        assert metric.respiratory_rate == 13.71
        assert metric.sleep_duration_minutes == 450.0
        assert metric.sleep_efficiency == 93.5

    async def test_none_does_not_clobber_existing_respiratory_rate(
        self, db_session, test_user
    ):
        day = date(2026, 1, 16)
        db_session.add(
            DailyMetric(
                user_id=test_user.id,
                metric_date=day,
                source="whoop",
                respiratory_rate=13.71,
                sleep_duration_minutes=450.0,
                sleep_efficiency=93.5,
            )
        )
        await db_session.flush()

        await _upsert_sleep_daily_metric(
            db_session,
            test_user.id,
            day,
            6 * 3600,
            88.0,
            None,
        )
        await db_session.flush()

        metric = await _get_metric(db_session, test_user.id, day)
        assert metric is not None
        assert metric.respiratory_rate == 13.71
        assert metric.sleep_duration_minutes == 360.0


class TestSleepSync:
    async def test_sync_reads_respiratory_rate_from_sleep_score(
        self, db_session, test_user
    ):
        record = {
            "id": "sleep-resp-1",
            "start": "2026-02-10T23:00:00Z",
            "end": "2026-02-11T07:00:00Z",
            "timezone_offset": "+00:00",
            "nap": False,
            "score_state": "SCORED",
            "score": {
                "stage_summary": {
                    "total_sleep_time_milli": 7 * 3600 * 1000,
                },
                "sleep_efficiency_percentage": 93.0,
                "respiratory_rate": 13.71,
            },
        }
        connection = SimpleNamespace(access_token="test-token")

        with (
            patch(
                "app.services.whoop.get_whoop_connection",
                new_callable=AsyncMock,
                return_value=connection,
            ),
            patch(
                "app.services.whoop.refresh_if_needed",
                new_callable=AsyncMock,
                side_effect=lambda db, conn: conn,
            ),
            patch(
                "app.services.whoop.whoop_client.get_all_sleep_activities",
                new_callable=AsyncMock,
                return_value=[record],
            ),
        ):
            await sync_whoop_sleep(db_session, test_user.id, limit=1)

        sleep_log = (
            await db_session.execute(
                select(SleepLog).where(
                    SleepLog.user_id == test_user.id,
                    SleepLog.sleep_date == date(2026, 2, 10),
                )
            )
        ).scalar_one_or_none()
        metric = await _get_metric(db_session, test_user.id, date(2026, 2, 10))

        assert sleep_log is not None
        assert metric is not None
        assert metric.respiratory_rate == 13.71
