"""Integration tests for the Feature 3 / B-15 analytics endpoints."""

from datetime import UTC, date, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.sleep import SleepLog
from app.models.user import User

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def sleep_history(db_session: AsyncSession, test_user: User) -> None:
    """11 nights of sleep covering all three bands evenly (5/6/7h)."""
    for i in range(1, 12):
        day = date.today() - timedelta(days=i)
        hours = 5.0 + (i % 3)  # 6.0 / 7.0 / 5.0 rotation
        db_session.add(
            SleepLog(
                user_id=test_user.id,
                source="manual",
                sleep_date=day,
                sleep_start=datetime(day.year, day.month, day.day, 22, 30),
                total_sleep_seconds=int(hours * 3600),
            )
        )
    await db_session.flush()


@pytest_asyncio.fixture
async def ride_history(db_session: AsyncSession, test_user: User) -> None:
    """10 rides with NP/TSS/RPE spread over the last 10 days."""
    for i in range(1, 11):
        start = datetime.now(UTC) - timedelta(days=i)
        db_session.add(
            Activity(
                user_id=test_user.id,
                source="strava",
                sport_type="cycling",
                name=f"Ride {i}",
                start_date=start,
                duration_seconds=3600,
                normalized_power=200.0 + (i % 3) * 20,
                tss=60.0 + i * 5,
                rpe=6.0 + (i % 3),
                provider_activity_id=f"strava_hist_{i}",
            )
        )
    await db_session.flush()


async def test_recompute_returns_six_insights(client, test_user: User):
    resp = await client.post("/api/v1/analytics/recompute")
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert {r["insight_type"] for r in rows} == {
        "recovery_cost",
        "sleep_performance",
        "load_readiness",
        "power_norms",
        "pr_clustering",
        "tsb_peak",
    }
    # Sparse fixture data → collecting confidence, never fabricated output.
    for r in rows:
        assert r["confidence"] == "collecting"
        assert r["period"] == "90d"


async def test_insights_list_returns_latest(client, test_user: User):
    await client.post("/api/v1/analytics/recompute")
    resp = await client.get("/api/v1/analytics/insights")
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 6


async def test_sleep_bands_populate(
    client, test_user: User, sleep_history, ride_history
):
    resp = await client.post("/api/v1/analytics/recompute")
    assert resp.status_code == 200, resp.text
    by_type = {r["insight_type"]: r for r in resp.json()}
    bands = by_type["sleep_performance"]["data"]["bands"]
    assert len(bands) >= 2  # rotation covers <6h/6–7h/7h+
    assert by_type["sleep_performance"]["sample_size"] >= 8
