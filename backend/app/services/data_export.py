"""Full user data export (§3.9) — serialize every per-user collection to JSON.

GDPR portability: the output is a single JSON document mirroring the app's data
model, so a user can inspect or re-import everything they've entered. Only rows
owned by the user are included — global shared seed data (e.g. ``Exercise``
rows with ``user_id = NULL``) is excluded, and the Strava webhook queue (no
user FK) is not part of anyone's personal data.
"""

import uuid
from collections.abc import Iterable
from datetime import date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.inspection import inspect as sa_inspect
from sqlalchemy.orm import selectinload

from app.models.activity import Activity, ActivitySource, ActivityStream
from app.models.cycling import CyclingProfile, FtpHistory
from app.models.daily_metric import DailyMetric
from app.models.event import Event
from app.models.exercise import Exercise
from app.models.goal import Goal
from app.models.health_alert import HealthAlert
from app.models.lifting import (
    LiftingSession,
    LiftingSet,
    PersonalRecord,
    WarmupTemplate,
    WarmupTemplateStep,
)
from app.models.llm_analysis import LlmAnalysis
from app.models.notification import Notification
from app.models.nutrition import RideFuelPlan
from app.models.push import PushSubscription
from app.models.route import Route, RouteSource
from app.models.route_organize import RouteCollection, RouteCollectionItem, RouteTag
from app.models.sleep import SleepLog
from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.models.user import OAuthConnection, User
from app.models.weather import CachedWeather
from app.models.weight import WeightLog


def _json_compatible(value: Any) -> Any:
    """Normalise a value for JSON output (dates/UUIDs → ISO/str)."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _serialize_row(obj: Any) -> dict[str, Any]:
    """Flatten an ORM instance to the raw dict of its column values."""
    return {
        col.key: _json_compatible(getattr(obj, col.key))
        for col in sa_inspect(obj).mapper.columns
    }


async def _query_user_rows(db: AsyncSession, model, user_id, *, load: Iterable = ()):
    """Return ORM instances for every row of ``model`` owned by ``user_id``."""
    stmt = select(model).where(model.user_id == user_id)
    stmt = stmt.options(*(selectinload(rel) for rel in load))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _query_one(db: AsyncSession, model, user_id, *, load: Iterable = ()):
    """Return the (possibly absent) one-to-one row for a user."""
    stmt = select(model).where(model.user_id == user_id)
    stmt = stmt.options(*(selectinload(rel) for rel in load))
    result = await db.execute(stmt)
    return result.scalars().first()


async def build_full_export(db: AsyncSession, user_id, user: User) -> dict[str, Any]:
    """Assemble the complete per-user export document."""
    now = datetime.utcnow().isoformat()

    activities = await _query_user_rows(
        db, Activity, user_id, load=(Activity.streams, Activity.sources)
    )
    sessions = await _query_user_rows(
        db, LiftingSession, user_id, load=(LiftingSession.sets,)
    )
    templates = await _query_user_rows(
        db, WarmupTemplate, user_id, load=(WarmupTemplate.steps,)
    )
    goals = await _query_user_rows(db, Goal, user_id, load=(Goal.check_ins,))
    plans = await _query_user_rows(db, TrainingPlan, user_id, load=(TrainingPlan.days,))
    routes = await _query_user_rows(
        db,
        Route,
        user_id,
        load=(Route.sources, Route.quality, Route.tags, Route.collection_items),
    )

    collections: dict[str, Any] = {
        # ── simple per-user tables ────────────────────────────────────────
        "oauth_connections": [
            _serialize_row(r)
            for r in await _query_user_rows(db, OAuthConnection, user_id)
        ],
        "ftp_history": [
            _serialize_row(r) for r in await _query_user_rows(db, FtpHistory, user_id)
        ],
        "daily_metrics": [
            _serialize_row(r) for r in await _query_user_rows(db, DailyMetric, user_id)
        ],
        "sleep_logs": [
            _serialize_row(r) for r in await _query_user_rows(db, SleepLog, user_id)
        ],
        "health_alerts": [
            _serialize_row(r) for r in await _query_user_rows(db, HealthAlert, user_id)
        ],
        "weight_logs": [
            _serialize_row(r) for r in await _query_user_rows(db, WeightLog, user_id)
        ],
        "personal_records": [
            _serialize_row(r)
            for r in await _query_user_rows(db, PersonalRecord, user_id)
        ],
        "events": [
            _serialize_row(r) for r in await _query_user_rows(db, Event, user_id)
        ],
        "llm_analyses": [
            _serialize_row(r) for r in await _query_user_rows(db, LlmAnalysis, user_id)
        ],
        "cached_weather": [
            _serialize_row(r)
            for r in await _query_user_rows(db, CachedWeather, user_id)
        ],
        "ride_fuel_plans": [
            _serialize_row(r) for r in await _query_user_rows(db, RideFuelPlan, user_id)
        ],
        "notifications": [
            _serialize_row(r) for r in await _query_user_rows(db, Notification, user_id)
        ],
        "push_subscriptions": [
            _serialize_row(r)
            for r in await _query_user_rows(db, PushSubscription, user_id)
        ],
        # User-created exercises only — shared seed rows (user_id=NULL) are not
        # personal data and are left out.
        "exercises": [
            _serialize_row(r) for r in await _query_user_rows(db, Exercise, user_id)
        ],
        "route_tags": [
            _serialize_row(r) for r in await _query_user_rows(db, RouteTag, user_id)
        ],
        "route_collections": [
            _serialize_row(r)
            for r in await _query_user_rows(db, RouteCollection, user_id)
        ],
        # ── one-to-one ────────────────────────────────────────────────────
        "cycling_profile": (
            _serialize_row(cycle)
            if (cycle := await _query_one(db, CyclingProfile, user_id)) is not None
            else None
        ),
        # ── trees (parent + nested children) ──────────────────────────────
        "activities": [
            {
                **_serialize_row(a),
                "children": {
                    "streams": [_serialize_row(s) for s in a.streams],
                    "sources": [_serialize_row(s) for s in a.sources],
                },
            }
            for a in activities
        ],
        "lifting_sessions": [
            {**_serialize_row(s), "sets": [_serialize_row(x) for x in s.sets]}
            for s in sessions
        ],
        "warmup_templates": [
            {**_serialize_row(t), "steps": [_serialize_row(x) for x in t.steps]}
            for t in templates
        ],
        "goals": [
            {**_serialize_row(g), "check_ins": [_serialize_row(c) for c in g.check_ins]}
            for g in goals
        ],
        "training_plans": [
            {**_serialize_row(p), "days": [_serialize_row(d) for d in p.days]}
            for p in plans
        ],
        "routes": [
            {
                **_serialize_row(r),
                "sources": [_serialize_row(s) for s in r.sources],
                "quality": _serialize_row(r.quality) if r.quality else None,
                "tag_ids": [str(t.id) for t in r.tags],
                "collection_ids": [str(c.collection_id) for c in r.collection_items],
            }
            for r in routes
        ],
    }

    return {
        "exported_at": now,
        "user": {
            "email": user.email,
            "name": user.name,
            "avatar_url": user.avatar_url,
            "notification_preferences": user.notification_preferences,
            "preferences": user.preferences,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "collections": collections,
    }
