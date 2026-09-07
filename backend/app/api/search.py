"""Global command-palette search — lightweight cross-domain lookup.

Backs the app-shell ⌘K search box. Each domain is queried independently with
a case-insensitive ``ILIKE`` on its primary name/notes column, truncated to a
small per-domain limit. Returns grouped results the frontend renders as a
single flat, deep-linkable list.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.event import Event
from app.models.exercise import Exercise
from app.models.goal import Goal
from app.models.lifting import LiftingSession
from app.models.route import Route
from app.models.user import User
from app.services.auth import get_current_user
from app.services.goal_metrics import METRIC_REGISTRY

router = APIRouter()


def _goal_label(goal: Goal) -> str:
    """Build a human label for a metric-based goal."""
    definition = METRIC_REGISTRY.get(goal.metric)
    metric_label = definition.label if definition else goal.metric
    ctx = goal.filter_json or {}
    name = ctx.get("exercise") or ctx.get("sport")
    if name:
        return f"{metric_label} — {name}"
    return metric_label


@router.get("")
async def global_search(
    q: str = "",
    limit: int = 5,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Search across activities, routes, lifting sessions, exercises, goals, and events."""
    query = q.strip()
    if not query:
        return {
            "query": "",
            "activities": [],
            "routes": [],
            "lifting_sessions": [],
            "exercises": [],
            "goals": [],
            "events": [],
        }

    needle = f"%{query}%"

    # Activities
    activities = list(
        (
            await db.execute(
                select(Activity)
                .where(
                    Activity.user_id == current_user.id,
                    Activity.name.ilike(needle),
                )
                .order_by(Activity.start_date.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    # Routes
    routes = list(
        (
            await db.execute(
                select(Route)
                .where(
                    Route.user_id == current_user.id,
                    Route.name.ilike(needle),
                )
                .order_by(Route.name)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    # Lifting sessions
    lifting_sessions = list(
        (
            await db.execute(
                select(LiftingSession)
                .where(
                    LiftingSession.user_id == current_user.id,
                    or_(
                        LiftingSession.program_name.ilike(needle),
                        LiftingSession.notes.ilike(needle),
                        LiftingSession.focus.ilike(needle),
                    ),
                )
                .order_by(LiftingSession.session_date.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    # Exercises (global reference catalogue — not per-user)
    exercises = list(
        (
            await db.execute(
                select(Exercise)
                .where(Exercise.name.ilike(needle))
                .order_by(Exercise.name)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    # Goals — match on notes, metric key, or filter context (exercise/sport)
    goal_filter = Goal.notes.ilike(needle) | Goal.metric.ilike(needle)
    for key in ("exercise", "sport"):
        goal_filter = or_(goal_filter, Goal.filter_json[key].as_string().ilike(needle))
    goals = list(
        (
            await db.execute(
                select(Goal)
                .where(Goal.user_id == current_user.id, goal_filter)
                .order_by(Goal.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    # Events
    events = list(
        (
            await db.execute(
                select(Event)
                .where(
                    Event.user_id == current_user.id,
                    Event.name.ilike(needle),
                )
                .order_by(Event.event_date.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    def _stringify(value: str | None) -> str | None:
        return str(value) if value is not None else None

    return {
        "query": query,
        "activities": [
            {
                "id": str(a.id),
                "name": a.name,
                "date": a.start_date.date().isoformat() if a.start_date else None,
                "sport_type": a.sport_type,
            }
            for a in activities
        ],
        "routes": [
            {
                "id": str(r.id),
                "name": r.name,
                "sport_type": r.sport_type,
            }
            for r in routes
        ],
        "lifting_sessions": [
            {
                "id": str(ls.id),
                "program_name": _stringify(ls.program_name),
                "focus": _stringify(ls.focus),
                "session_date": ls.session_date.isoformat(),
            }
            for ls in lifting_sessions
        ],
        "exercises": [
            {"id": str(e.id), "name": e.name, "category": _stringify(e.category)}
            for e in exercises
        ],
        "goals": [
            {
                "id": str(g.id),
                "label": _goal_label(g),
                "metric": g.metric,
                "target_value": g.target_value,
                "status": g.status,
            }
            for g in goals
        ],
        "events": [
            {
                "id": str(ev.id),
                "name": ev.name,
                "event_date": ev.event_date.isoformat(),
                "event_type": ev.event_type,
            }
            for ev in events
        ],
    }
