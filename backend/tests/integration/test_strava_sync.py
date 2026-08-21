"""Integration tests for Strava sync service (expensive).

These tests exercise the sync service functions directly (not via HTTP).
Only Strava HTTP responses are mocked at the boundary.

Run with:  pytest tests/integration/test_strava_sync.py -m integration
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity, ActivitySource, ActivityStream
from app.models.user import OAuthConnection

pytestmark = [pytest.mark.integration, pytest.mark.expensive]

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def strava_responses():
    """Load recorded Strava API responses from fixture file."""
    with open(FIXTURES_DIR / "strava_responses.json") as f:
        return json.load(f)


@pytest_asyncio.fixture
async def strava_connection(db_session: AsyncSession, test_user) -> OAuthConnection:
    """Insert a Strava OAuthConnection for the test user."""
    conn = OAuthConnection(
        user_id=test_user.id,
        provider="strava",
        provider_user_id="strava_user_123",
        access_token="fake_access_token",
        refresh_token="fake_refresh_token",
        token_expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db_session.add(conn)
    await db_session.flush()
    return conn


# ── sync_activities ──────────────────────────────────────────────────────


class TestSyncActivities:
    """sync_activities() — creates Activity records from Strava API response."""

    async def test_creates_activity_records(
        self, db_session, test_user, strava_connection, strava_responses,
    ):
        """Sync creates Activity records from Strava API data."""
        from app.services.strava.sync import sync_activities

        with patch("app.services.strava.sync.strava_client") as mock_client:
            mock_client.get_activities = AsyncMock(
                return_value=strava_responses["activities"][:2],
            )
            mock_client.get_activity_streams = AsyncMock(
                return_value=strava_responses["activity_streams"],
            )

            synced = await sync_activities(db_session, test_user.id)

        assert len(synced) == 2
        # Verify first activity
        names = {a.name for a in synced}
        assert "Morning Ride" in names
        assert "Evening Recovery Spin" in names

        # Verify DB records
        result = await db_session.execute(
            select(Activity).where(Activity.user_id == test_user.id)
        )
        activities = list(result.scalars().all())
        assert len(activities) == 2

    async def test_creates_activity_streams_for_cycling(
        self, db_session, test_user, strava_connection, strava_responses,
    ):
        """Sync creates ActivityStream records for cycling activities."""
        from app.services.strava.sync import sync_activities

        with patch("app.services.strava.sync.strava_client") as mock_client:
            mock_client.get_activities = AsyncMock(
                return_value=strava_responses["activities"][:1],  # Just the cycling ride
            )
            mock_client.get_activity_streams = AsyncMock(
                return_value=strava_responses["activity_streams"],
            )

            synced = await sync_activities(db_session, test_user.id)

        assert len(synced) == 1

        # Verify streams were created
        result = await db_session.execute(
            select(ActivityStream).where(ActivityStream.activity_id == synced[0].id)
        )
        streams = list(result.scalars().all())
        stream_types = {s.stream_type for s in streams}
        assert "watts" in stream_types
        assert "heartrate" in stream_types

    async def test_handles_duplicate_activities_idempotent(
        self, db_session, test_user, strava_connection, strava_responses,
    ):
        """Sync is idempotent — running twice doesn't create duplicates."""
        from app.services.strava.sync import sync_activities

        activities_data = strava_responses["activities"][:1]

        with patch("app.services.strava.sync.strava_client") as mock_client:
            mock_client.get_activities = AsyncMock(return_value=activities_data)
            mock_client.get_activity_streams = AsyncMock(
                return_value=strava_responses["activity_streams"],
            )

            # First sync
            synced1 = await sync_activities(db_session, test_user.id)
            assert len(synced1) == 1

            # Second sync with same data
            synced2 = await sync_activities(db_session, test_user.id)
            assert len(synced2) == 0  # No new activities

        # Verify only one activity exists
        result = await db_session.execute(
            select(Activity).where(Activity.user_id == test_user.id)
        )
        activities = list(result.scalars().all())
        assert len(activities) == 1

    async def test_handles_strava_api_errors_gracefully(
        self, db_session, test_user, strava_connection,
    ):
        """Sync raises ValueError when no connection exists."""
        from app.services.strava.sync import sync_activities

        # Delete the connection
        await db_session.delete(strava_connection)
        await db_session.flush()

        with pytest.raises(ValueError, match="No Strava connection"):
            await sync_activities(db_session, test_user.id)


# ── backfill_all_activities ──────────────────────────────────────────────


class TestBackfillAllActivities:
    """backfill_all_activities() — backfills historical activities."""

    async def test_backfills_historical_activities(
        self, db_session, test_user, strava_connection, strava_responses,
    ):
        """Backfill creates Activity records from multiple pages."""
        from app.services.strava.sync import backfill_all_activities

        with patch("app.services.strava.sync.strava_client") as mock_client:
            # First page returns activities, second page returns empty
            mock_client.get_activities = AsyncMock(
                side_effect=[
                    strava_responses["activities"],
                    [],  # No more pages
                ],
            )
            mock_client.get_activity_streams = AsyncMock(
                return_value=strava_responses["activity_streams"],
            )

            result = await backfill_all_activities(db_session, test_user.id)

        assert result["synced"] == 5
        assert result["pages"] >= 1

        # Verify all activities in DB
        db_result = await db_session.execute(
            select(Activity).where(Activity.user_id == test_user.id)
        )
        activities = list(db_result.scalars().all())
        assert len(activities) == 5
