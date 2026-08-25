"""Smoke tests for Celery scheduler tasks — error isolation and per-user commits.

These tests verify the critical patterns fixed in Phase 1.2/1.3:
- A2: Per-user rollback on failure (session doesn't poison subsequent users)
- A3: Per-user commit (watermarks survive mid-task crashes)
"""

import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class _TestError(Exception):
    """Custom exception for scheduler task tests (avoids TRY002)."""


def _make_connection(user_id, provider="strava", last_synced_at=None):
    """Build a mock OAuthConnection."""
    conn = MagicMock()
    conn.user_id = user_id
    conn.provider = provider
    conn.last_synced_at = last_synced_at
    return conn


def _make_mock_session(connections=None):
    """Build a mock AsyncSession with execute returning connections."""
    db = AsyncMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.flush = AsyncMock()

    # Chain: execute().scalars().all() returns connections
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = connections or []
    db.execute = AsyncMock(return_value=mock_result)

    return db


@asynccontextmanager
async def _mock_task_session(db):
    """Yield the mock db as a task_session context manager."""
    yield db


class TestStravaSyncErrorIsolation:
    """Test that one user's failure doesn't kill the loop for others."""

    def test_second_user_processed_after_first_fails(self):
        """If user 1's sync raises, user 2's sync still runs."""
        from app.tasks.scheduler import sync_all_strava_activities

        user1 = _make_connection("user-1", "strava")
        user2 = _make_connection("user-2", "strava")
        db = _make_mock_session([user1, user2])

        call_count = 0

        async def mock_sync(db, user_id, after=None):
            nonlocal call_count
            call_count += 1
            if user_id == "user-1":
                raise _TestError("Strava API down")
            return [{"id": "act1"}]

        with patch("app.database.task_session", lambda: _mock_task_session(db)), \
             patch("app.services.strava.sync_activities", side_effect=mock_sync), \
             patch("app.services.strava.link_all_unlinked_activities", return_value=0), \
             patch("app.services.merge_service.backfill_activity_route_links", return_value=0), \
             patch("app.services.weather.tag_recent_activities", return_value=0), \
             patch("app.services.conformity.link_activities_to_plan_days", return_value=0):
            result = sync_all_strava_activities()

        # Both users attempted
        assert call_count == 2
        # User 1's failure rolled back, user 2 committed
        assert db.rollback.call_count >= 1
        assert db.commit.call_count >= 1

    def test_watermark_committed_per_user(self):
        """Each successful user's watermark is committed immediately."""
        from app.tasks.scheduler import sync_all_strava_activities

        user1 = _make_connection("user-1", "strava")
        user2 = _make_connection("user-2", "strava")
        db = _make_mock_session([user1, user2])

        async def mock_sync(db, user_id, after=None):
            return [{"id": "act1"}]

        # Mock Wahoo query to return empty (no Wahoo connections)
        wahoo_result = MagicMock()
        wahoo_result.scalars.return_value.all.return_value = []
        original_execute = db.execute

        async def execute_side_effect(*args, **kwargs):
            # First call: Strava connections; second call: Wahoo connections
            if execute_side_effect.call_count == 0:
                execute_side_effect.call_count += 1
                # Return the original mock result (Strava connections)
                mock_r = MagicMock()
                mock_r.scalars.return_value.all.return_value = [user1, user2]
                return mock_r
            else:
                # Wahoo connections — return empty
                return wahoo_result

        execute_side_effect.call_count = 0
        db.execute = AsyncMock(side_effect=execute_side_effect)

        with patch("app.database.task_session", lambda: _mock_task_session(db)), \
             patch("app.services.strava.sync_activities", side_effect=mock_sync), \
             patch("app.services.strava.link_all_unlinked_activities", return_value=0), \
             patch("app.services.merge_service.backfill_activity_route_links", return_value=0), \
             patch("app.services.weather.tag_recent_activities", return_value=0), \
             patch("app.services.conformity.link_activities_to_plan_days", return_value=0):
            sync_all_strava_activities()

        # Commit called once per Strava user (2 users, both succeed)
        # No Wahoo connections so no Wahoo commits
        assert db.commit.call_count == 2
        # No rollback on success
        db.rollback.assert_not_called()


class TestWhoopSyncErrorIsolation:
    """Test Whoop sync error isolation."""

    def test_second_user_after_first_cycle_failure(self):
        """User 1 cycle sync failure doesn't prevent user 2 processing."""
        from app.tasks.scheduler import sync_all_whoop_data

        user1 = _make_connection("user-1", "whoop")
        user2 = _make_connection("user-2", "whoop")
        db = _make_mock_session([user1, user2])

        async def mock_refresh(db, conn):
            return conn

        cycle_count = 0

        async def mock_cycles(db, user_id, start=None):
            nonlocal cycle_count
            cycle_count += 1
            if user_id == "user-1":
                raise _TestError("Whoop API error")
            return [{"id": "cycle1"}]

        with patch("app.database.task_session", lambda: _mock_task_session(db)), \
             patch("app.services.whoop.refresh_if_needed", side_effect=mock_refresh), \
             patch("app.services.whoop.sync_whoop_cycles", side_effect=mock_cycles), \
             patch("app.services.whoop.sync_whoop_sleep", return_value=[]), \
             patch("app.services.whoop.sync_whoop_workouts", return_value=[]), \
             patch("app.services.whoop.sync_whoop_weight", return_value=None):
            result = sync_all_whoop_data()

        assert cycle_count == 2
        assert db.rollback.call_count >= 1
        assert db.commit.call_count >= 1


class TestWeatherTaskErrorIsolation:
    """Test weather forecast refresh error isolation."""

    def test_second_user_after_first_failure(self):
        """User 1 weather failure doesn't prevent user 2."""
        from app.tasks.scheduler import refresh_weather_forecasts

        user1 = MagicMock()
        user1.id = "user-1"
        user2 = MagicMock()
        user2.id = "user-2"
        db = _make_mock_session([user1, user2])

        call_count = 0

        async def mock_resolve(db, user_id):
            nonlocal call_count
            call_count += 1
            if user_id == "user-1":
                raise _TestError("Open-Meteo down")
            return (51.5, -0.1)

        async def mock_forecast(db, user_id, lat, lng, days=7):
            return {}

        with patch("app.database.task_session", lambda: _mock_task_session(db)), \
             patch("app.services.weather.resolve_user_coords", side_effect=mock_resolve), \
             patch("app.services.weather.get_forecast", side_effect=mock_forecast):
            result = refresh_weather_forecasts()

        assert call_count == 2
        assert db.rollback.call_count >= 1
        assert db.commit.call_count >= 1


class TestGoalCheckinErrorIsolation:
    """Test goal check-in error isolation."""

    def test_second_user_after_first_failure(self):
        """User 1 goal check-in failure doesn't prevent user 2."""
        from app.tasks.scheduler import record_goal_checkins

        user1 = MagicMock()
        user1.id = "user-1"
        user2 = MagicMock()
        user2.id = "user-2"

        # Sequential execute returns: first call = users, subsequent = empty goals
        users_result = MagicMock()
        users_result.scalars.return_value.all.return_value = [user1, user2]
        goals_result = MagicMock()
        goals_result.scalars.return_value.all.return_value = []

        call_idx = 0

        async def execute_side_effect(*args, **kwargs):
            nonlocal call_idx
            call_idx += 1
            if call_idx == 1:
                return users_result
            return goals_result

        db = _make_mock_session()
        db.execute = AsyncMock(side_effect=execute_side_effect)

        checkin_count = 0

        async def mock_checkins(db, user_id):
            nonlocal checkin_count
            checkin_count += 1
            if user_id == "user-1":
                raise _TestError("DB error")
            return 0

        with patch("app.database.task_session", lambda: _mock_task_session(db)), \
             patch("app.services.goals.record_all_check_ins", side_effect=mock_checkins):
            result = record_goal_checkins()

        assert checkin_count == 2
        assert db.rollback.call_count >= 1
        assert db.commit.call_count >= 1
