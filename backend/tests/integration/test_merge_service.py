"""Integration tests for the merge service (expensive).

These tests exercise the merge/dedup service functions directly with real DB.
No external APIs are mocked — only the database is used.

Run with:  pytest tests/integration/test_merge_service.py -m integration
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity, ActivitySource

pytestmark = [pytest.mark.integration, pytest.mark.expensive]


# ── Duplicate Detection ──────────────────────────────────────────────────


class TestFindDuplicateActivity:
    """find_duplicate_activity() — detects same-activity-from-different-providers."""

    async def test_finds_duplicate_with_matching_timestamps(
        self, db_session, test_user, test_activity,
    ):
        """Detects a duplicate when timestamps are within 30 minutes."""
        from app.services.merge_service import find_duplicate_activity

        duplicate = await find_duplicate_activity(
            db_session,
            test_user.id,
            sport_type="cycling",
            start_date=test_activity.start_date + timedelta(minutes=10),
            duration_seconds=3600,
            distance_meters=50_000.0,
        )
        assert duplicate is not None
        assert duplicate.id == test_activity.id

    async def test_returns_none_for_different_dates(
        self, db_session, test_user, test_activity,
    ):
        """Returns None when activities are on different dates."""
        from app.services.merge_service import find_duplicate_activity

        duplicate = await find_duplicate_activity(
            db_session,
            test_user.id,
            sport_type="cycling",
            start_date=test_activity.start_date + timedelta(days=3),
            duration_seconds=3600,
            distance_meters=50_000.0,
        )
        assert duplicate is None

    async def test_returns_none_for_different_sport_type(
        self, db_session, test_user, test_activity,
    ):
        """Returns None when sport types don't match."""
        from app.services.merge_service import find_duplicate_activity

        duplicate = await find_duplicate_activity(
            db_session,
            test_user.id,
            sport_type="running",
            start_date=test_activity.start_date + timedelta(minutes=5),
            duration_seconds=3600,
            distance_meters=50_000.0,
        )
        assert duplicate is None


# ── Merge Logic ──────────────────────────────────────────────────────────


class TestMergeActivity:
    """merge_activity() — merges data from a duplicate into the primary."""

    async def test_merges_two_activities_from_different_sources(
        self, db_session, test_user, test_activity,
    ):
        """Merging adds an ActivitySource and updates fields from higher-priority provider."""
        from app.services.merge_service import merge_activity

        new_data = {
            "name": "Updated Ride Name",
            "average_power": 210.0,
            "calories": 850.0,
        }
        await merge_activity(
            db_session, test_activity, new_data, "wahoo", "wahoo_999",
        )
        await db_session.flush()

        # Verify ActivitySource was created
        result = await db_session.execute(
            select(ActivitySource).where(
                ActivitySource.activity_id == test_activity.id,
                ActivitySource.provider == "wahoo",
            )
        )
        source = result.scalar_one_or_none()
        assert source is not None
        assert source.provider_activity_id == "wahoo_999"

    async def test_rejects_merge_from_same_source(
        self, db_session, test_user, test_activity,
    ):
        """Merging from the same provider should not create a duplicate source."""
        from app.services.merge_service import merge_activity

        # First merge from strava (same as existing)
        new_data = {"name": "Test"}
        await merge_activity(
            db_session, test_activity, new_data, "strava", "strava_12345",
        )
        await db_session.flush()

        # Should not create a duplicate ActivitySource
        result = await db_session.execute(
            select(ActivitySource).where(
                ActivitySource.activity_id == test_activity.id,
                ActivitySource.provider == "strava",
            )
        )
        sources = list(result.scalars().all())
        # Should have exactly 1 strava source (the original)
        assert len(sources) == 1


# ── Score Calculation ────────────────────────────────────────────────────


class TestMatchScore:
    """_compute_activity_match_score() — scoring for merge candidates."""

    def test_perfect_match_scores_high(self):
        """Activities with same time, sport, duration, distance score near 1.0."""
        from app.services.merge_service import _compute_activity_match_score

        candidate = Activity(
            sport_type="cycling",
            start_date=datetime(2026, 8, 15, 7, 0, 0, tzinfo=UTC),
            duration_seconds=3600,
            distance_meters=42000.0,
        )
        score = _compute_activity_match_score(
            candidate,
            sport_type="cycling",
            start_date=datetime(2026, 8, 15, 7, 10, 0, tzinfo=UTC),
            duration_seconds=3600,
            distance_meters=42000.0,
        )
        assert score >= 0.9

    def test_different_sport_scores_low(self):
        """Activities with different sport types score low."""
        from app.services.merge_service import _compute_activity_match_score

        candidate = Activity(
            sport_type="cycling",
            start_date=datetime(2026, 8, 15, 7, 0, 0, tzinfo=UTC),
            duration_seconds=3600,
            distance_meters=42000.0,
        )
        score = _compute_activity_match_score(
            candidate,
            sport_type="running",
            start_date=datetime(2026, 8, 15, 7, 10, 0, tzinfo=UTC),
            duration_seconds=3600,
            distance_meters=42000.0,
        )
        assert score < 0.7
