"""Integration test fixtures — real database, real HTTP requests, no mocking of internals.

Provides:
 - A test PostgreSQL database engine with all tables created
 - Transactional session that rolls back after each test (test isolation)
 - FastAPI app with ``get_db`` and ``get_current_user`` overridden
 - ``httpx.AsyncClient`` for real HTTP endpoint testing
 - Pre-built domain objects (user, cycling profile, activity, lifting session)
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.database import Base, get_db
from app.models.activity import Activity, ActivityStream
from app.models.cycling import CyclingProfile, FtpHistory
from app.models.daily_metric import DailyMetric
from app.models.event import Event
from app.models.goal import Goal
from app.models.health_alert import HealthAlert
from app.models.lifting import LiftingSession, LiftingSet, PersonalRecord
from app.models.route import Route, RouteSource
from app.models.sleep import SleepLog
from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.models.user import User
from app.models.weight import WeightLog
from app.services.auth import get_current_user

# ── Test database URL ─────────────────────────────────────────────────────
# Override via TEST_DATABASE_URL environment variable to point at a dedicated
# test database.  Default assumes a local PostgreSQL with the standard
# fittrack_dev credentials and a ``fittrack_test`` database.
TEST_DATABASE_URL: str = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack_test",
)


# ── Engine & table lifecycle ──────────────────────────────────────────────


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    """Create an async engine, create all ORM tables, yield, then tear down."""
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


# ── Per-test transactional session ────────────────────────────────────────


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Provide a transactional ``AsyncSession`` that rolls back after every test.

    Uses ``engine.begin()`` so the connection is wrapped in a SQLAlchemy-managed
    transaction.  After the test the session is closed and the connection
    transaction is explicitly rolled back, ensuring zero side effects.
    """
    async with test_engine.begin() as conn:
        session = AsyncSession(bind=conn, expire_on_commit=False)
        try:
            yield session
        finally:
            await session.close()
            await conn.rollback()


# ── Domain-object fixtures ────────────────────────────────────────────────


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Insert and return a real ``User`` row."""
    user = User(id=uuid.uuid4(), email="test@example.com", name="Test User")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def test_cycling_profile(
    db_session: AsyncSession, test_user: User
) -> CyclingProfile:
    """Insert a ``CyclingProfile`` with known FTP and weight."""
    profile = CyclingProfile(
        user_id=test_user.id,
        ftp_watts=250.0,
        weight_kg=75.0,
        lactate_threshold_hr=170.0,
    )
    db_session.add(profile)
    await db_session.flush()
    return profile


@pytest_asyncio.fixture
async def test_activity(db_session: AsyncSession, test_user: User) -> Activity:
    """Insert a cycling ``Activity`` with a power stream."""
    activity = Activity(
        user_id=test_user.id,
        source="strava",
        sport_type="cycling",
        name="Morning Ride",
        start_date=datetime.now(UTC) - timedelta(days=1),
        duration_seconds=3600,
        distance_meters=50_000.0,
        elevation_gain_meters=500.0,
        average_power=200.0,
        normalized_power=210.0,
        average_heartrate=150.0,
        max_heartrate=180.0,
        average_speed=13.89,
        average_cadence=85.0,
        tss=80.0,
        calories=800.0,
        provider_activity_id="strava_12345",
    )
    db_session.add(activity)
    await db_session.flush()

    # Power stream (1 point per 10 s → 360 points for a 1-hour ride)
    power_stream = ActivityStream(
        activity_id=activity.id,
        stream_type="watts",
        data={"data": [200 + (i % 50) for i in range(360)]},
        resolution=10,
    )
    db_session.add(power_stream)
    await db_session.flush()
    return activity


@pytest_asyncio.fixture
async def test_lifting_session(
    db_session: AsyncSession, test_user: User
) -> LiftingSession:
    """Insert a ``LiftingSession`` with three working sets of Back Squat."""
    session = LiftingSession(
        user_id=test_user.id,
        session_date=date.today() - timedelta(days=min(date.today().weekday(), 3)),
        focus="squat",
        duration_seconds=3600,
        rpe_session=7.5,
        notes="Good session",
    )
    db_session.add(session)
    await db_session.flush()

    for i in range(3):
        db_session.add(
            LiftingSet(
                session_id=session.id,
                exercise_name="Back Squat",
                set_number=i + 1,
                weight_kg=100.0 + i * 5,
                reps=5,
                rpe=6.0 + i * 0.5,
            )
        )
    await db_session.flush()
    await db_session.refresh(session, ["sets"])
    return session


@pytest_asyncio.fixture
async def test_daily_metric(db_session: AsyncSession, test_user: User) -> DailyMetric:
    """Insert a ``DailyMetric`` with recovery, HRV, strain, resting HR, sleep hours."""
    metric = DailyMetric(
        user_id=test_user.id,
        metric_date=date.today() - timedelta(days=1),
        source="whoop",
        recovery_score=72.0,
        hrv_ms=55.0,
        strain=12.5,
        resting_hr=58.0,
        sleep_duration_minutes=420,
        sleep_efficiency=92.0,
        respiratory_rate=15.2,
    )
    db_session.add(metric)
    await db_session.flush()
    return metric


@pytest_asyncio.fixture
async def test_sleep_log(db_session: AsyncSession, test_user: User) -> SleepLog:
    """Insert a ``SleepLog`` with hours, efficiency, deep sleep."""
    log = SleepLog(
        user_id=test_user.id,
        sleep_date=date.today() - timedelta(days=1),
        source="whoop",
        total_sleep_seconds=28800,  # 8 hours
        deep_sleep_seconds=5400,  # 90 min
        rem_sleep_seconds=7200,  # 120 min
        light_sleep_seconds=16200,  # 270 min
        sleep_efficiency=92.0,
        sleep_start=datetime.now(UTC) - timedelta(hours=10),
        sleep_end=datetime.now(UTC) - timedelta(hours=2),
    )
    db_session.add(log)
    await db_session.flush()
    return log


@pytest_asyncio.fixture
async def test_weight_log(db_session: AsyncSession, test_user: User) -> WeightLog:
    """Insert a ``WeightLog`` entry."""
    log = WeightLog(
        user_id=test_user.id,
        date=date.today() - timedelta(days=1),
        weight_kilogram=75.5,
        source="manual",
    )
    db_session.add(log)
    await db_session.flush()
    return log


@pytest_asyncio.fixture
async def test_health_alert(db_session: AsyncSession, test_user: User) -> HealthAlert:
    """Insert an active overtraining ``HealthAlert``."""
    alert = HealthAlert(
        user_id=test_user.id,
        alert_type="overtraining",
        severity="warning",
        title="Overtraining Risk",
        description="Training load is elevated — consider a rest day.",
        evidence={"TSB": -30, "recovery": 35},
        detected_date=date.today(),
        status="active",
    )
    db_session.add(alert)
    await db_session.flush()
    return alert


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession, test_user: User) -> Event:
    """Insert an upcoming race ``Event``."""
    event = Event(
        user_id=test_user.id,
        name="Summer Century Ride",
        event_date=date.today() + timedelta(days=30),
        event_type="race",
        target_tss=250.0,
        taper_days=14,
        notes="First century of the season",
    )
    db_session.add(event)
    await db_session.flush()
    return event


@pytest_asyncio.fixture
async def test_training_plan(db_session: AsyncSession, test_user: User) -> TrainingPlan:
    """Insert a ``TrainingPlan`` with ``TrainingPlanDay`` entries."""
    plan = TrainingPlan(
        user_id=test_user.id,
        name="4-Week Build",
        description="Progressive build phase",
        start_date=date.today(),
        end_date=date.today() + timedelta(weeks=4),
        plan_type="build",
        status="active",
    )
    db_session.add(plan)
    await db_session.flush()

    for i in range(7):
        day = TrainingPlanDay(
            plan_id=plan.id,
            day_date=date.today() + timedelta(days=i),
            planned_tss=100.0 + i * 10,
            planned_duration_min=60 + i * 5,
            planned_type="rest" if i == 6 else ("hard" if i == 2 else "moderate"),
        )
        db_session.add(day)
    await db_session.flush()
    await db_session.refresh(plan, ["days"])
    return plan


@pytest_asyncio.fixture
async def test_route(db_session: AsyncSession, test_user: User) -> Route:
    """Insert a ``Route`` with a simple polyline."""
    # A simple encoded polyline for a short route near London
    encoded = "o}~mH~}xMz@z@z@z@z@z@"
    route = Route(
        user_id=test_user.id,
        name="Richmond Park Loop",
        sport_type="cycling",
        distance_meters=15000.0,
        elevation_gain_meters=200.0,
        encoded_polyline=encoded,
        start_lat=51.4430,
        start_lng=-0.2710,
        end_lat=51.4430,
        end_lng=-0.2710,
        is_loop=True,
    )
    db_session.add(route)
    await db_session.flush()

    source = RouteSource(
        route_id=route.id,
        provider="strava",
        provider_route_id="strava_route_123",
        provider_name="Richmond Park Loop",
        encoded_polyline=encoded,
    )
    db_session.add(source)
    await db_session.flush()
    await db_session.refresh(route, ["sources"])
    return route


@pytest_asyncio.fixture
async def test_route_with_surface(db_session: AsyncSession, test_user: User) -> Route:
    """Insert a ``Route`` with a surface_profile JSONB field."""
    encoded = "o}~mH~}xMz@z@z@z@z@z@"
    route = Route(
        user_id=test_user.id,
        name="Gravel Adventure",
        sport_type="cycling",
        distance_meters=25000.0,
        elevation_gain_meters=400.0,
        encoded_polyline=encoded,
        start_lat=51.5074,
        start_lng=-0.1278,
        end_lat=51.5074,
        end_lng=-0.1278,
        is_loop=False,
        surface_profile={"paved": 60, "gravel": 30, "dirt": 10},
    )
    db_session.add(route)
    await db_session.flush()
    return route


@pytest_asyncio.fixture
async def test_route_activities(
    db_session: AsyncSession, test_user: User, test_route: Route
) -> list[Activity]:
    """Insert 3 activities linked to the test route with varying durations."""
    activities = []
    for i, (days_ago, duration) in enumerate([(1, 3600), (7, 3000), (14, 4200)]):
        activity = Activity(
            user_id=test_user.id,
            route_id=test_route.id,
            source="strava",
            sport_type="cycling",
            name=f"Route Ride {i + 1}",
            start_date=datetime.now(UTC) - timedelta(days=days_ago),
            duration_seconds=duration,
            distance_meters=15000.0,
            average_power=200.0 + i * 10,
            tss=70.0 + i * 10,
            provider_activity_id=f"strava_route_{100 + i}",
        )
        db_session.add(activity)
        activities.append(activity)
    await db_session.flush()
    return activities


@pytest_asyncio.fixture
async def test_ftp_history(db_session: AsyncSession, test_user: User) -> FtpHistory:
    """Insert a ``FtpHistory`` entry."""
    ftp = FtpHistory(
        user_id=test_user.id,
        ftp_watts=250.0,
        effective_date=date.today() - timedelta(days=30),
        source="manual",
    )
    db_session.add(ftp)
    await db_session.flush()
    return ftp


@pytest_asyncio.fixture
async def test_personal_record(
    db_session: AsyncSession, test_user: User
) -> PersonalRecord:
    """Insert a ``PersonalRecord`` entry."""
    pr = PersonalRecord(
        user_id=test_user.id,
        exercise_name="Back Squat",
        record_type="1rm",
        weight_kg=180.0,
        reps=1,
        estimated_1rm=180.0,
        achieved_date=date.today() - timedelta(days=7),
    )
    db_session.add(pr)
    await db_session.flush()
    return pr


@pytest_asyncio.fixture
async def test_multiple_activities(
    db_session: AsyncSession, test_user: User
) -> list[Activity]:
    """Insert 5 cycling activities spread over the last 30 days with varying TSS/power/distance."""
    activities = []
    for i in range(5):
        days_ago = 1 + i * 6  # spread over ~30 days
        activity = Activity(
            user_id=test_user.id,
            source="strava",
            sport_type="cycling",
            name=f"Ride {i + 1}",
            start_date=datetime.now(UTC) - timedelta(days=days_ago),
            duration_seconds=3600 + i * 600,
            distance_meters=40_000.0 + i * 10_000,
            elevation_gain_meters=300.0 + i * 100,
            average_power=180.0 + i * 10,
            normalized_power=190.0 + i * 10,
            average_heartrate=140.0 + i * 5,
            max_heartrate=175.0 + i * 3,
            average_speed=13.0 + i * 0.5,
            average_cadence=80.0 + i * 2,
            tss=60.0 + i * 15,
            calories=600.0 + i * 100,
            provider_activity_id=f"strava_{10000 + i}",
        )
        db_session.add(activity)
        activities.append(activity)
    await db_session.flush()
    return activities


# ── FastAPI app + HTTP client ─────────────────────────────────────────────


@pytest_asyncio.fixture
async def app(db_session: AsyncSession, test_user: User) -> FastAPI:
    """Return the production ``FastAPI`` app with test overrides applied.

    * ``get_db`` → yields the transactional test session
    * ``get_current_user`` → returns the test user
    * Lifespan is replaced with a no-op (avoids Alembic migration subprocess)
    """
    from app.main import app as _app

    # ── Replace lifespan to skip Alembic (tables already exist) ──────────
    @asynccontextmanager
    async def _noop_lifespan(_a: FastAPI):
        yield

    _app.router.lifespan_context = _noop_lifespan

    # ── Dependency overrides ─────────────────────────────────────────────
    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def _override_get_current_user() -> User:
        return test_user

    _app.dependency_overrides[get_db] = _override_get_db
    _app.dependency_overrides[get_current_user] = _override_get_current_user

    yield _app

    _app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(app: FastAPI) -> AsyncGenerator[httpx.AsyncClient, None]:
    """An ``httpx.AsyncClient`` that sends real HTTP requests to the app."""
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
