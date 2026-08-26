"""Regression tests for SSE backfill persistence.

Both SSE backfill endpoints create a dedicated session via
``async_session_factory`` (never ``get_db``), so any work that is only
flushed — not committed — is rolled back when the endpoint closes the
session. Historically the Whoop chunked backfill committed nothing at all
and the Strava backfill lost its tail page, all streams, and all link
mutations.

These tests run each generator inside its own session, close it exactly
like the endpoint does, then assert the data actually persisted.

Run with:  pytest tests/integration/test_backfill_persistence.py -m integration
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.activity import Activity, ActivitySource, ActivityStream
from app.models.daily_metric import DailyMetric
from app.models.user import User

pytestmark = [pytest.mark.integration, pytest.mark.expensive]

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def strava_responses():
    """Load recorded Strava API responses from fixture file."""
    with open(FIXTURES_DIR / "strava_responses.json") as f:
        return json.load(f)


async def _new_session(test_engine) -> AsyncSession:
    return AsyncSession(bind=test_engine, expire_on_commit=False)


# ── Strava backfill ───────────────────────────────────────────────────────


class TestStravaBackfillPersistence:
    """The Strava backfill generator must persist tail page + streams + links
    via a final commit, not just flushes."""

    async def test_tail_streams_and_links_persist_after_session_close(
        self, test_engine, strava_responses
    ):
        from app.models.user import OAuthConnection
        from app.services.strava.sync import backfill_all_activities_stream

        user = User(
            id=uuid.uuid4(), email="backfill-strava@example.com", name="Strava Backfill"
        )
        conn = OAuthConnection(
            user_id=user.id,
            provider="strava",
            provider_user_id="strava_user_backfill",
            access_token="fake_access_token",
            refresh_token="fake_refresh_token",
            token_expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        strava_id = str(strava_responses["activities"][0]["id"])

        # Run the generator in its own session (like the SSE endpoint does),
        # then close the session without an explicit trailing commit.
        session = await _new_session(test_engine)
        session.add(user)
        session.add(conn)
        await session.commit()

        try:
            with patch("app.services.strava.sync.strava_client") as mock_client:
                # Single partial page (< 100) → no 10-page boundary commit fires.
                mock_client.get_activities = AsyncMock(
                    return_value=strava_responses["activities"][:1],
                )
                mock_client.get_activity_streams = AsyncMock(
                    return_value=strava_responses["activity_streams"],
                )

                events = []
                async for event in backfill_all_activities_stream(
                    session, user.id, max_pages=2
                ):
                    events.append(event)
        finally:
            await session.close()

        assert any(e["type"] == "complete" for e in events)

        # A fresh session (as a subsequent request would use) must see:
        # 1. the activity from the tail page,
        # 2. its ActivitySource record,
        # 3. its streams — all previously lost on session close.
        fresh = await _new_session(test_engine)
        try:
            activities = (
                await fresh.execute(select(Activity).where(Activity.user_id == user.id))
            ).scalars().all()
            sources = (
                await fresh.execute(select(ActivitySource))
            ).scalars().all()
            streams = (
                await fresh.execute(
                    select(ActivityStream).where(
                        ActivityStream.activity_id.in_([a.id for a in activities])
                    )
                )
            ).scalars().all()
        finally:
            await fresh.close()

        assert len(activities) == 1
        assert any(
            s.provider_activity_id == strava_id and s.activity_id == activities[0].id
            for s in sources
        )
        stream_types = {s.stream_type for s in streams}
        assert "watts" in stream_types

        # Cleanup — this test commits permanently (unlike the rollback fixture).
        cleanup = await _new_session(test_engine)
        await cleanup.execute(delete(User).where(User.id == user.id))
        await cleanup.commit()
        await cleanup.close()


# ── Whoop chunked backfill ────────────────────────────────────────────────


class TestWhoopChunkedBackfillPersistence:
    """Each chunk of the Whoop chunked backfill must commit independently so
    the data survives session close."""

    async def test_chunks_commit_and_survive_session_close(self, test_engine):
        from app.services.whoop import backfill_whoop_chunked

        user = User(
            id=uuid.uuid4(), email="backfill-whoop@example.com", name="Whoop Backfill"
        )

        def fake_backfill(db, user_id, months=0, start_dt=None, end_dt=None):
            metric = DailyMetric(
                user_id=user_id,
                metric_date=start_dt.date(),
                source="whoop",
                recovery_score=70.0,
            )
            db.add(metric)
            return {
                "synced_cycles": 1,
                "synced_sleep": 0,
                "synced_workouts": 0,
                "months": months,
            }

        session = await _new_session(test_engine)
        session.add(user)
        await session.commit()

        try:
            with patch(
                "app.services.whoop.backfill_whoop_data", side_effect=fake_backfill
            ), patch("asyncio.sleep", new=AsyncMock()):
                events = []
                async for event in backfill_whoop_chunked(
                    session, user.id, months=6, chunk_months=3
                ):
                    events.append(event)
        finally:
            await session.close()

        assert any(e["type"] == "complete" for e in events)

        fresh = await _new_session(test_engine)
        try:
            metrics = (
                await fresh.execute(
                    select(DailyMetric).where(DailyMetric.user_id == user.id)
                )
            ).scalars().all()
        finally:
            await fresh.close()

        # One committed row per chunk — nothing rolled back on session close.
        assert len(metrics) == 2

        cleanup = await _new_session(test_engine)
        await cleanup.execute(delete(User).where(User.id == user.id))
        await cleanup.commit()
        await cleanup.close()