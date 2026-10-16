"""Undo restorers for plan-day structural operations (C6).

Kept out of ``services/undo.py`` so the mechanism stays free of feature
imports. Registration is explicit (:func:`register_restorers`, called by the
undo router) rather than an import side effect, so the wiring is greppable.
"""

from __future__ import annotations

import uuid
from datetime import date as _date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.undo import register

# Columns a restored day may carry. Server-managed links (``activity_id``,
# ``lifting_session_id``) and the row id are deliberately excluded: a restore
# recreates the *plan*, and re-attaching an actual is a separate, explicit act.
_DAY_FIELDS = (
    "day_date",
    "sport",
    "planned_type",
    "planned_tss",
    "planned_duration_min",
    "workout_description",
    "planned_focus",
    "planned_exercises",
    "planned_volume_kg",
    "planned_rpe",
    "planned_power_watts",
    "planned_zone",
    "notes",
    "completed",
)


def snapshot_day(day: Any) -> dict[str, Any]:
    """A JSON-native snapshot of a day, for a ``plan_day_delete`` claim.

    JSON-native matters (see ``services/undo.record_undo``): dates and UUIDs
    must be strings, because that is what the restorer reads back.
    """
    snap: dict[str, Any] = {}
    for field in _DAY_FIELDS:
        value = getattr(day, field, None)
        snap[field] = value.isoformat() if isinstance(value, _date) else value
    snap["planned_route_id"] = (
        str(day.planned_route_id) if day.planned_route_id else None
    )
    snap["warmup_template_id"] = (
        str(day.warmup_template_id) if day.warmup_template_id else None
    )
    return snap


async def restore_plan_day_delete(
    db: AsyncSession, user_id: uuid.UUID, payload: dict[str, Any]
) -> dict[str, Any]:
    """Recreate a deleted plan day from its snapshot (C6)."""
    from app.models.training_plan import TrainingPlan, TrainingPlanDay
    from app.services.training_plan import sports_conflict_on_date

    plan_id = uuid.UUID(payload["plan_id"])
    owned = (
        await db.execute(
            select(TrainingPlan.id).where(
                TrainingPlan.id == plan_id, TrainingPlan.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if owned is None:
        raise ValueError("Training plan not found")

    snap = dict(payload["day"])
    if isinstance(snap.get("day_date"), str):
        snap["day_date"] = _date.fromisoformat(snap["day_date"])
    for field in ("planned_route_id", "warmup_template_id"):
        if isinstance(snap.get(field), str):
            snap[field] = uuid.UUID(snap[field])

    # Refuse rather than clobber: a re-sync may have recreated a session of the
    # same sport at that date, and that is a conflict, not a restore. A session
    # of another sport is not — a date holds one session per sport, so a
    # deleted lift restores beside a ride. Asked of the database directly,
    # *not* of ``plan.days`` — a long-lived session can hold a collection loaded
    # before the delete, and reading it here would report a day that no longer
    # exists (and so refuse every restore).
    occupied_sports = (
        (
            await db.execute(
                select(TrainingPlanDay.sport).where(
                    TrainingPlanDay.plan_id == plan_id,
                    TrainingPlanDay.day_date == snap["day_date"],
                )
            )
        )
        .scalars()
        .all()
    )
    if any(
        sports_conflict_on_date(sport, snap["sport"]) for sport in occupied_sports
    ):
        raise ValueError("A session of that sport already exists on that date")

    day = TrainingPlanDay(plan_id=plan_id, **snap)
    db.add(day)
    await db.flush()
    return {"restored_day_id": str(day.id), "day_date": snap["day_date"].isoformat()}


def register_restorers() -> None:
    """Register the plan-day restorers. Called once by the undo router."""
    register("plan_day_delete", restore_plan_day_delete)
