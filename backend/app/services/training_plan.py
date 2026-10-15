"""Training plan business logic — template generation, full-array day upsert
(deletes dates missing from the payload), event linkage with auto-taper, plan
CRUD, weekly view enrichment (Phase 5B), and targeted single-day edits
(add / update / delete / swap).

Services follow the ``(db: AsyncSession, user_id, ...)`` convention and raise
``ValueError`` for user-facing validation errors (routers translate to HTTP).
"""

import logging
import re
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity
from app.models.event import Event
from app.models.lifting import (
    LiftingSession,
    LiftingSet,
    WarmupTemplate,
    WarmupTemplateStep,
)
from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.schemas.training_plan import (
    ActualActivity,
    ActualLiftingSession,
    BadWeather,
    DayWeather,
    ExerciseSuggestion,
    GeneratePlanRequest,
    StrengthDaySuggestion,
    StrengthPlanSuggestionsResponse,
    StrengthWeekTemplate,
    TrainingPlanCreate,
    TrainingPlanDayCreate,
    TrainingPlanDayRead,
    TrainingPlanDayUpdate,
    TrainingPlanUpdate,
    TrainingWeekDay,
    TrainingWeekResponse,
    WarmupStepRead,
    WarmupTemplateRead,
    WeekReadiness,
    WeekRouteMatch,
)
from app.services.cycling import (
    CTL_WARMUP_DAYS,
    compute_training_load,
    get_daily_tss,
    get_or_create_cycling_profile,
)
from app.services.weather import get_forecast, is_bad_weather, resolve_user_coords
from app.services.workout_planner import (
    find_matching_routes,
    get_readiness_recommendation,
    plan_workout,
)

logger = logging.getLogger(__name__)

VALID_PLAN_TYPES = {"custom", "build", "base", "peak", "taper", "recovery", "strength"}
VALID_PLAN_STATUSES = {"draft", "active", "completed", "archived"}
VALID_DAY_TYPES = {"rest", "easy", "moderate", "hard", "race"}

# Weekly strength-focus rotation applied to Tue/Thu strength days.
FOCUS_ROTATION = ["squat", "bench", "deadlift"]

# Valid planned_focus values (merged from old focus + session_type).
VALID_FOCUS_VALUES = {
    "squat",
    "bench",
    "deadlift",
    "overhead_press",
    "accessories",
    "full_body",
    "push",
    "pull",
    "legs",
    "upper",
    "lower",
}

# Map common free-text focus strings (from LiftingSession.focus) to valid values.
_FOCUS_ALIASES: dict[str, str] = {
    "squat": "squat",
    "back squat": "squat",
    "front squat": "squat",
    "bench": "bench",
    "bench press": "bench",
    "deadlift": "deadlift",
    "conventional deadlift": "deadlift",
    "sumo deadlift": "deadlift",
    "overhead press": "overhead_press",
    "ohp": "overhead_press",
    "shoulder press": "overhead_press",
    "accessories": "accessories",
    "accessory": "accessories",
    "full body": "full_body",
    "full_body": "full_body",
    "push": "push",
    "chest": "push",
    "pull": "pull",
    "back": "pull",
    "legs": "legs",
    "lower": "lower",
    "upper": "upper",
}


def _normalise_focus(raw: str | None) -> str | None:
    """Map a free-text focus string to a valid ``planned_focus`` value.

    Returns the canonical value if a match is found, otherwise title-cased
    input as a best-effort fallback (the column is free-text anyway).
    """
    if not raw:
        return None
    key = raw.strip().lower()
    return _FOCUS_ALIASES.get(key, raw.strip())


# Cycle-day TSS multipliers relative to daily_tss (weekly TSS / 4.5 ride days).
_RIDE_MULTIPLIERS = {
    0: 0.9,  # Mon — moderate
    2: 1.4,  # Wed — hard
    4: 0.9,  # Fri — moderate
    5: 1.3,  # Sat — long
}

# ── Strength exercise templates ──────────────────────────────────────────
# Weights are intentionally None — the athlete fills targets per session.

_STRENGTH_TEMPLATES: dict[str, dict[str, list[dict]]] = {
    "squat": {
        "main": [
            {
                "exercise": "Back Squat",
                "sets": 5,
                "reps": 5,
                "weight_kg": None,
                "rpe": 8,
            },
            {
                "exercise": "Leg Press",
                "sets": 3,
                "reps": 10,
                "weight_kg": None,
                "rpe": 7,
            },
            {
                "exercise": "Walking Lunge",
                "sets": 3,
                "reps": 12,
                "weight_kg": None,
                "rpe": 7,
            },
        ],
        "accessories": [
            {
                "exercise": "Front Squat",
                "sets": 3,
                "reps": 8,
                "weight_kg": None,
                "rpe": 7,
            },
            {
                "exercise": "Leg Extension",
                "sets": 3,
                "reps": 12,
                "weight_kg": None,
                "rpe": 7,
            },
            {"exercise": "Plank", "sets": 3, "reps": 45, "weight_kg": None, "rpe": 6},
        ],
    },
    "bench": {
        "main": [
            {
                "exercise": "Bench Press",
                "sets": 5,
                "reps": 5,
                "weight_kg": None,
                "rpe": 8,
            },
            {
                "exercise": "Incline Dumbbell Press",
                "sets": 3,
                "reps": 10,
                "weight_kg": None,
                "rpe": 7,
            },
            {
                "exercise": "Barbell Row",
                "sets": 3,
                "reps": 8,
                "weight_kg": None,
                "rpe": 7,
            },
        ],
        "accessories": [
            {
                "exercise": "Overhead Press",
                "sets": 4,
                "reps": 8,
                "weight_kg": None,
                "rpe": 7,
            },
            {
                "exercise": "Cable Fly",
                "sets": 3,
                "reps": 12,
                "weight_kg": None,
                "rpe": 6,
            },
            {
                "exercise": "Triceps Pushdown",
                "sets": 3,
                "reps": 12,
                "weight_kg": None,
                "rpe": 6,
            },
        ],
    },
    "deadlift": {
        "main": [
            {"exercise": "Deadlift", "sets": 4, "reps": 3, "weight_kg": None, "rpe": 8},
            {
                "exercise": "Romanian Deadlift",
                "sets": 3,
                "reps": 8,
                "weight_kg": None,
                "rpe": 7,
            },
            {"exercise": "Pull Up", "sets": 3, "reps": 8, "weight_kg": None, "rpe": 7},
        ],
        "accessories": [
            {
                "exercise": "Hip Thrust",
                "sets": 4,
                "reps": 10,
                "weight_kg": None,
                "rpe": 7,
            },
            {
                "exercise": "Barbell Row",
                "sets": 3,
                "reps": 10,
                "weight_kg": None,
                "rpe": 7,
            },
            {
                "exercise": "Back Extension",
                "sets": 3,
                "reps": 12,
                "weight_kg": None,
                "rpe": 6,
            },
        ],
    },
}


# ── Template generation ──────────────────────────────────────────────────


def _strength_day(
    day_date: date,
    focus: str,
    variant: str,
    duration_min: int,
) -> TrainingPlanDayCreate:
    """Build a strength training-plan day from the focus templates."""
    return TrainingPlanDayCreate(
        day_date=day_date,
        sport="strength",
        planned_type="moderate",
        planned_duration_min=duration_min,
        planned_focus=focus,
        planned_exercises=_STRENGTH_TEMPLATES[focus][variant],
        planned_rpe=8 if variant == "main" else 6.5,
    )


def _generate_plan_days(
    template_type: str,
    weeks: int,
    start_date: date,
    base_tss: float,
) -> list[TrainingPlanDayCreate]:
    """Generate mixed-week training plan days from a template type.

    Weekly structure (matches suggested-cycle logic):
    - Sunday: rest
    - Tuesday + Thursday: strength days, planned_focus rotating
      squat → bench → deadlift by week
    - Monday / Wednesday / Friday / Saturday: cycle days
      (Wed hard 1.4×, Sat long 1.3×, Mon/Fri moderate 0.9× of daily TSS)

    Progressive weekly-load patterns:
    - base: steady ~65% load
    - build: progressive increase (~8%/week)
    - peak: highest load weeks with slight increase
    - taper: progressive reduction (20% less each week)
    - recovery: very low load
    """
    days: list[TrainingPlanDayCreate] = []

    for week in range(weeks):
        if template_type == "build":
            week_tss = base_tss * (1 + 0.08 * week)
        elif template_type == "base":
            week_tss = base_tss * 0.65
        elif template_type == "peak":
            week_tss = base_tss * (1.1 + 0.02 * week)
        elif template_type == "taper":
            week_tss = base_tss * (0.8**week)
        elif template_type == "recovery":
            week_tss = base_tss * 0.3
        else:
            week_tss = base_tss

        # Weekly TSS is distributed across the 4 ride days (multipliers sum to 4.5).
        daily_tss = week_tss / 4.5

        for day_offset in range(7):
            day_date = start_date + timedelta(weeks=week, days=day_offset)
            dow = day_date.weekday()  # 0=Mon … 6=Sun

            if dow == 6:  # Sunday = rest
                days.append(
                    TrainingPlanDayCreate(
                        day_date=day_date,
                        sport="rest",
                        planned_tss=0,
                        planned_duration_min=0,
                        planned_type="rest",
                    )
                )
            elif dow in (1, 3):  # Tue / Thu = strength
                focus = FOCUS_ROTATION[week % len(FOCUS_ROTATION)]
                variant = "main" if dow == 1 else "accessories"
                days.append(_strength_day(day_date, focus, variant, duration_min=60))
            elif dow == 2:  # Wednesday = hard ride
                tss = daily_tss * _RIDE_MULTIPLIERS[dow]
                days.append(
                    TrainingPlanDayCreate(
                        day_date=day_date,
                        sport="cycle",
                        planned_tss=round(tss, 1),
                        planned_duration_min=int(tss / 1.0),
                        planned_type="hard" if template_type != "recovery" else "easy",
                    )
                )
            elif dow == 5:  # Saturday = long/hard ride
                tss = daily_tss * _RIDE_MULTIPLIERS[dow]
                ptype = "hard" if template_type in ("build", "peak") else "moderate"
                if template_type == "taper" and week == weeks - 1:
                    ptype = "race"
                days.append(
                    TrainingPlanDayCreate(
                        day_date=day_date,
                        sport="cycle",
                        planned_tss=round(tss, 1),
                        planned_duration_min=int(tss / 0.9),
                        planned_type=ptype,
                    )
                )
            else:  # Mon / Fri = moderate rides
                tss = daily_tss * _RIDE_MULTIPLIERS[dow]
                days.append(
                    TrainingPlanDayCreate(
                        day_date=day_date,
                        sport="cycle",
                        planned_tss=round(tss, 1),
                        planned_duration_min=int(tss / 0.8),
                        planned_type="moderate"
                        if template_type != "recovery"
                        else "easy",
                    )
                )

    return days


# ── Strength plan generation (user-defined progressive overload) ────────────

# Default focus rotation for strength days
_DEFAULT_STRENGTH_FOCUSES = ["squat", "bench", "deadlift"]

# NOTE: a previous revision carried an RPE→weight-step table here
# (flat +5 kg for RPE 6–9, no upper/lower-body split). It was never called —
# live autoregulation uses the %-based adjustWeightForRpe rule (frontend
# reference.ts, +2.5%/−5%), which is the sounder behaviour — so the dead
# table was removed rather than left to mislead a future wiring.


def _strength_plan_days(
    weeks: int,
    start_date: date,
    focuses: list[str] | None = None,
    template: list["StrengthWeekTemplate"] | None = None,
) -> list[TrainingPlanDayCreate]:
    """Generate a user-defined strength plan with progressive overload.

    Structure:
    - Days 1, 3, 5: main strength days (one per focus in rotation)
    - Days 2, 4, 6: accessory/variation work
    - Day 7: rest

    The ``template`` parameter lets the user override RPE/sets/reps/weights
    per week. Unset weeks inherit from the nearest preceding week.
    """
    days: list[TrainingPlanDayCreate] = []
    focuses = focuses or list(_DEFAULT_STRENGTH_FOCUSES)

    # Build per-week template lookup (0-indexed internally)
    tmpl_by_week: dict[int, dict] = {}
    if template:
        for entry in template:
            week_idx = entry.week - 1
            tmpl_by_week[week_idx] = {
                "rpe": entry.rpe,
                "sets": entry.sets,
                "reps": entry.reps,
                "weights": entry.weights,
                "notes": entry.notes,
            }

    # Inherit values from nearest preceding week
    current_rpe: float = 8.0
    current_sets: int = 5
    current_reps: int = 5
    current_weights: dict[str, float] = {}

    for week in range(weeks):
        entry = tmpl_by_week.get(week)
        if entry:
            if entry.get("rpe") is not None:
                current_rpe = entry["rpe"]
            if entry.get("sets") is not None:
                current_sets = entry["sets"]
            if entry.get("reps") is not None:
                current_reps = entry["reps"]
            if entry.get("weights"):
                current_weights.update(entry["weights"])

        focus = focuses[week % len(focuses)]
        template_week = entry.get("notes") if entry else None

        for day_offset in range(7):
            day_date = start_date + timedelta(weeks=week, days=day_offset)
            dow = day_date.weekday()

            if dow == 6:  # Sunday = rest
                days.append(
                    TrainingPlanDayCreate(
                        day_date=day_date,
                        sport="rest",
                        planned_tss=0,
                        planned_duration_min=0,
                        planned_type="rest",
                    )
                )
            elif dow in (0, 2, 4):  # Mon, Wed, Fri = main strength days
                day_focus = focuses[(week + dow // 2) % len(focuses)]
                weight = current_weights.get(day_focus)
                days.append(_strength_day(day_date, day_focus, "main", duration_min=75))
                # Override RPE/sets/reps on the last exercise of main
                if days[-1].planned_exercises:
                    for ex in days[-1].planned_exercises:
                        if current_rpe is not None:
                            ex["rpe"] = round(current_rpe, 1)
                        if current_sets is not None:
                            ex["sets"] = current_sets
                        if current_reps is not None and dow == 2:
                            ex["reps"] = current_reps
                        if weight is not None and ex.get(
                            "exercise", ""
                        ).lower().startswith(day_focus):
                            ex["weight_kg"] = round(weight, 1)
                if template_week:
                    days[-1].workout_description = template_week
            elif dow == 1 or dow == 3:  # Tue, Thu = accessories
                days.append(
                    _strength_day(day_date, focus, "accessories", duration_min=45)
                )
                if days[-1].planned_exercises:
                    for ex in days[-1].planned_exercises:
                        if current_rpe is not None:
                            ex["rpe"] = round(current_rpe - 1, 1)
                        if current_sets is not None:
                            ex["sets"] = max(2, current_sets - 1)
                        if current_reps is not None:
                            ex["reps"] = current_reps + 2
            else:  # Sat = optional second session or rest
                days.append(_strength_day(day_date, focus, "main", duration_min=60))
                if days[-1].planned_exercises:
                    for ex in days[-1].planned_exercises:
                        if current_rpe is not None:
                            ex["rpe"] = round(current_rpe - 0.5, 1)
                        if current_sets is not None:
                            ex["sets"] = max(2, current_sets - 1)
                        if current_reps is not None:
                            ex["reps"] = current_reps + 2

    return days


# ── Strength suggestion logic (smart weight adjustment for big 3) ──────────

# Conformity threshold for auto-suggesting weight increases (0-100)
SUGGEST_WEIGHT_THRESHOLD = 85.0

# Weight increments based on RPE proximity
_STEP_WELL_EASY = 5.0  # RPE 0.5+ below target: +5kg
_STEP_WELL_MATCH = 2.5  # RPE within ±0.5 of target: +2.5kg


def _classify_big3_exercise(exercise_name: str) -> str | None:
    """Classify an exercise name as squat/bench/deadlift or return None."""
    name = exercise_name.lower()
    if "squat" in name:
        return "squat"
    if "bench" in name or "press" in name:
        return "bench"
    if "deadlift" in name:
        return "deadlift"
    return None


async def suggest_strength_updates(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
) -> dict:
    """Suggest weight updates for upcoming big-3 exercises based on RPE.

    Focuses on the Big 3 (squat, bench, deadlift). Uses the most recent
    completed strength session to evaluate whether the user hit their planned
    RPE targets, and suggests weight adjustments for the same exercises in
    upcoming days.

    - RPE within tolerance (±0.5): matched well, suggest +2.5kg
    - RPE below planned: user had capacity, suggest +5kg
    - RPE above planned: user struggled, suggest maintain
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise LookupError("Training plan not found")

    today = date.today()

    # Get all strength days, sorted by date
    strength_days = sorted(
        [d for d in plan.days if d.sport == "strength"],
        key=lambda d: d.day_date,
    )

    # Find the most recent completed strength day with a linked session
    from app.services.conformity import get_day_conformity

    completed_days: list[tuple[TrainingPlanDay, dict]] = []
    for day in reversed(strength_days):  # most recent first
        if day.day_date < today and day.lifting_session_id:
            try:
                conformity = await get_day_conformity(db, user_id, plan_id, day.id)
                completed_days.append((day, conformity))
            except (ValueError, LookupError):
                continue

    if not completed_days:
        return {
            "plan_id": plan.id,
            "generated_at": datetime.now(UTC),
            "suggestions": [],
            "summary": "No completed strength days with linked sessions found.",
        }

    # Use the most recent completed day for RPE analysis
    latest_day, latest_conformity = completed_days[0]
    overall_pct = latest_conformity.get("conformity_pct") or 0

    if overall_pct < SUGGEST_WEIGHT_THRESHOLD:
        return {
            "plan_id": plan.id,
            "generated_at": datetime.now(UTC),
            "suggestions": [],
            "summary": (
                f"Latest completed strength day ({latest_day.day_date}) "
                f"scored {overall_pct:.0f}% conformity "
                f"(below {SUGGEST_WEIGHT_THRESHOLD:.0f}% threshold). "
                "No weight suggestions — consider adjusting the plan."
            ),
        }

    # Load the lifting session with its sets
    from app.models.lifting import LiftingSession

    session = None
    if latest_day.lifting_session_id:
        result = await db.execute(
            select(LiftingSession)
            .where(LiftingSession.id == latest_day.lifting_session_id)
            .options(selectinload(LiftingSession.sets))
        )
        session = result.scalar_one_or_none()

    if not session or not session.sets:
        return {
            "plan_id": plan.id,
            "generated_at": datetime.now(UTC),
            "suggestions": [],
            "summary": "Completed strength day has no linked session with sets.",
        }

    # Build actual RPE/weight lookup for big 3 exercises from the session
    actual_by_big3: dict[str, dict] = {}

    completed_exercises = latest_day.planned_exercises or []
    for planned_ex in completed_exercises:
        ex_name = planned_ex.get("exercise", "")
        big3_name = _classify_big3_exercise(ex_name)
        if big3_name is None:
            continue

        planned_rpe = planned_ex.get("rpe")
        planned_weight = planned_ex.get("weight_kg") or 0

        # Find matching sets in the session
        matching_sets = [
            s
            for s in session.sets
            if _classify_big3_exercise(s.exercise_name) == big3_name
        ]

        if not matching_sets:
            continue

        # For the main working sets (non-warmup), compute actual RPE and weight
        working_sets = [s for s in matching_sets if not s.is_warmup]
        if not working_sets:
            continue

        # Use the heaviest set's RPE as the primary indicator
        heaviest_set = max(working_sets, key=lambda s: s.weight_kg or 0)
        actual_rpe = heaviest_set.rpe
        actual_weight = heaviest_set.weight_kg or 0

        if actual_rpe is None:
            continue

        actual_by_big3[big3_name] = {
            "planned_rpe": planned_rpe,
            "actual_rpe": actual_rpe,
            "completed_weight_kg": actual_weight,
            "planned_weight_kg": planned_weight,
        }

    if not actual_by_big3:
        return {
            "plan_id": plan.id,
            "generated_at": datetime.now(UTC),
            "suggestions": [],
            "summary": "No big 3 exercises (squat/bench/deadlift) found in "
            "the completed session.",
        }

    # Find upcoming strength days and suggest weight updates for big 3
    upcoming_days = [
        d for d in strength_days if d.day_date >= today and d.planned_exercises
    ]

    suggestions: list[dict] = []
    summary_parts = [
        (
            f"Latest session scored {overall_pct:.0f}% conformity. "
            "Suggesting weight updates for upcoming big-3 exercises:"
        )
    ]

    for up_day in upcoming_days[:3]:  # next 3 strength days
        ex_suggestions: list[dict] = []

        for planned_ex in up_day.planned_exercises or []:
            ex_name = planned_ex.get("exercise", "")
            big3_name = _classify_big3_exercise(ex_name)
            if big3_name is None:
                continue

            perf = actual_by_big3.get(big3_name)
            if perf is None:
                continue

            actual_rpe = perf["actual_rpe"]
            planned_rpe = perf["planned_rpe"] or 8.0
            completed_weight = perf["completed_weight_kg"]

            # The planned weight for the upcoming day
            upcoming_weight = planned_ex.get("weight_kg") or completed_weight

            # RPE-based weight suggestion
            rpe_gap = actual_rpe - planned_rpe  # positive = struggled

            if rpe_gap > 0.5:
                # User struggled — suggest maintaining weight
                suggested_weight = round(completed_weight, 1)
            elif rpe_gap < -0.5:
                # User had capacity — suggest +5kg
                suggested_weight = round(completed_weight + _STEP_WELL_EASY, 1)
            else:
                # RPE matched well — suggest +2.5kg
                suggested_weight = round(completed_weight + _STEP_WELL_MATCH, 1)

            ex_suggestions.append(
                {
                    "exercise_name": planned_ex.get("exercise", ""),
                    "old_weight_kg": upcoming_weight,
                    "suggested_weight_kg": suggested_weight,
                    "rpe": actual_rpe,
                    "sets": planned_ex.get("sets", 0),
                    "reps": planned_ex.get("reps", 0),
                }
            )

        if ex_suggestions:
            suggestions.append(
                {
                    "day_id": str(up_day.id),
                    "day_date": up_day.day_date.isoformat(),
                    "sport": "strength",
                    "planned_focus": up_day.planned_focus,
                    "exercises": ex_suggestions,
                }
            )
            summary_parts.append(
                f"  {up_day.day_date}: {len(ex_suggestions)} exercises"
            )

    summary_parts.append(f"Based on session from {latest_day.day_date}.")

    return {
        "plan_id": plan.id,
        "generated_at": datetime.now(UTC),
        "suggestions": suggestions,
        "summary": " ".join(summary_parts),
    }


# ── Internal helpers ─────────────────────────────────────────────────────


def _validate_days(days: list[TrainingPlanDayCreate]) -> None:
    """Validate day payloads before persisting."""
    for day_data in days:
        if day_data.planned_type not in VALID_DAY_TYPES:
            raise ValueError(f"Invalid planned_type: {day_data.planned_type}")
        if day_data.sport not in ("cycle", "strength", "rest"):
            raise ValueError(f"Invalid sport: {day_data.sport}")


async def _get_plan_or_none(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
) -> TrainingPlan | None:
    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.id == plan_id, TrainingPlan.user_id == user_id)
        .options(selectinload(TrainingPlan.days))
    )
    return result.scalar_one_or_none()


async def _reload_plan(db: AsyncSession, plan_id: uuid.UUID) -> TrainingPlan:
    """Re-fetch a plan with its days (refreshes columns expired by flush).

    ``populate_existing`` forces already-loaded attributes/collections
    (e.g. ``plan.days`` after upserts) to be refreshed from the database.
    """
    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.id == plan_id)
        .options(selectinload(TrainingPlan.days))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


# ── Day persistence (full-array upsert — destructive by omission) ─────────


async def save_plan_days(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    days: list[TrainingPlanDayCreate],
) -> TrainingPlan:
    """Upsert plan days matched by ``day_date``.

    - Existing dates: update provided fields only (completed / activity_id /
      lifting_session_id are preserved unless explicitly included in payload).
    - New dates: insert.
    - Missing dates: **delete** (so the caller must send the complete set).

    Because omission deletes, this path is destructive — prefer the targeted
    day endpoints (``add_plan_day`` / ``update_plan_day`` / ``delete_plan_day``
    / ``swap_plan_days``) for editing.
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    _validate_days(days)

    existing_by_date = {day.day_date: day for day in plan.days}
    incoming_dates: set[date] = set()

    for day_data in days:
        incoming_dates.add(day_data.day_date)
        row = existing_by_date.get(day_data.day_date)
        if row is None:
            row = TrainingPlanDay(
                plan_id=plan.id, **day_data.model_dump(exclude_unset=True)
            )
            db.add(row)
            existing_by_date[row.day_date] = row
        else:
            # Only apply fields the caller actually sent — untouched columns
            # (completed flags, linked activity/lifting sessions) survive.
            for key, value in day_data.model_dump(exclude_unset=True).items():
                setattr(row, key, value)

    for day_date, row in list(existing_by_date.items()):
        if day_date not in incoming_dates:
            await db.delete(row)
            del existing_by_date[day_date]

    # Auto-fill cycling fields when type changes (Feature 2)
    from app.models.cycling import CyclingProfile

    profile_result = await db.execute(
        select(CyclingProfile).where(CyclingProfile.user_id == user_id)
    )
    profile = profile_result.scalar_one_or_none()
    ftp = profile.ftp_watts if profile and profile.ftp_watts else None

    if ftp:
        for day_date, row in existing_by_date.items():
            if row.sport == "cycle" and row.planned_type and row.planned_type != "rest":
                difficulty = _TYPE_TO_DIFFICULTY.get(row.planned_type)
                if difficulty and row.planned_duration_min:
                    # Only auto-fill if user didn't explicitly set these values
                    needs_fill = (row.planned_tss is None) or (
                        row.planned_power_watts is None
                    )
                    if needs_fill:
                        targets = plan_workout(
                            ftp=ftp,
                            lthr=profile.lactate_threshold_hr if profile else None,
                            weight_kg=profile.weight_kg if profile else None,
                            difficulty=difficulty,
                            duration_minutes=row.planned_duration_min,
                        )
                        if targets:
                            if row.planned_tss is None:
                                row.planned_tss = targets.target_tss_low
                            if row.planned_power_watts is None:
                                row.planned_power_watts = targets.target_power_low

    await db.flush()
    return await _reload_plan(db, plan_id)


# ── Event linkage + auto-taper ───────────────────────────────────────────


async def link_event_and_apply_taper(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan: TrainingPlan,
    event_id: uuid.UUID,
) -> TrainingPlan:
    """Link a plan to an event and taper the final days.

    - Clamps ``plan.end_date`` to the event date if the plan extends past it.
    - Applies a linear 100% → 40% TSS ramp across the final
      ``min(event.taper_days, plan length)`` days.
    """
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.user_id == user_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise ValueError("Event not found")

    plan.event_id = event.id
    plan.end_date = min(plan.end_date, event.event_date)

    plan_length_days = (plan.end_date - plan.start_date).days + 1
    taper_window = min(event.taper_days, plan_length_days)
    if taper_window > 0:
        window_start = plan.end_date - timedelta(days=taper_window - 1)
        taper_days = sorted(
            (d for d in plan.days if window_start <= d.day_date <= plan.end_date),
            key=lambda d: d.day_date,
        )
        count = len(taper_days)
        for i, day in enumerate(taper_days):
            factor = 1.0 if count <= 1 else 1.0 - 0.6 * (i / (count - 1))
            if day.planned_tss is not None:
                day.planned_tss = round(day.planned_tss * factor, 1)

    await db.flush()
    return plan


# ── CRUD ─────────────────────────────────────────────────────────────────


async def get_plan(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
) -> TrainingPlan | None:
    return await _get_plan_or_none(db, user_id, plan_id)


async def list_plans(
    db: AsyncSession, user_id: uuid.UUID, status_filter: str | None = None
) -> list[TrainingPlan]:
    query = (
        select(TrainingPlan)
        .where(TrainingPlan.user_id == user_id)
        .options(selectinload(TrainingPlan.days))
        .order_by(TrainingPlan.created_at.desc())
    )
    if status_filter:
        query = query.where(TrainingPlan.status == status_filter)
    result = await db.execute(query)
    return list(result.scalars().unique().all())


async def create_plan(
    db: AsyncSession, user_id: uuid.UUID, data: TrainingPlanCreate
) -> TrainingPlan:
    """Create a training plan with optional days."""
    if data.plan_type not in VALID_PLAN_TYPES:
        raise ValueError(
            f"Invalid plan_type. Must be one of: {', '.join(VALID_PLAN_TYPES)}"
        )
    if data.status not in VALID_PLAN_STATUSES:
        raise ValueError(
            f"Invalid status. Must be one of: {', '.join(VALID_PLAN_STATUSES)}"
        )
    if data.end_date < data.start_date:
        raise ValueError("end_date must be after start_date")
    _validate_days(data.days)

    plan = TrainingPlan(
        user_id=user_id,
        name=data.name,
        description=data.description,
        start_date=data.start_date,
        end_date=data.end_date,
        plan_type=data.plan_type,
        status=data.status,
        strength_progression=data.strength_progression,  # S1 rules (nullable)
    )
    db.add(plan)
    await db.flush()

    for day_data in data.days:
        db.add(TrainingPlanDay(plan_id=plan.id, **day_data.model_dump()))
    await db.flush()

    # Load the days collection before taper (avoid async lazy-load).
    plan = await _reload_plan(db, plan.id)
    if data.event_id:
        plan = await link_event_and_apply_taper(db, user_id, plan, data.event_id)

    return await _reload_plan(db, plan.id)


async def update_plan(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    data: TrainingPlanUpdate,
) -> TrainingPlan:
    """Update a plan. Days, if provided, replace the day set (destructive)."""
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    update_fields = data.model_dump(exclude_unset=True, exclude={"days"})
    if update_fields.get("plan_type") and data.plan_type not in VALID_PLAN_TYPES:
        raise ValueError(
            f"Invalid plan_type. Must be one of: {', '.join(VALID_PLAN_TYPES)}"
        )
    if update_fields.get("status") and data.status not in VALID_PLAN_STATUSES:
        raise ValueError(
            f"Invalid status. Must be one of: {', '.join(VALID_PLAN_STATUSES)}"
        )
    start = update_fields.get("start_date", plan.start_date)
    end = update_fields.get("end_date", plan.end_date)
    if end < start:
        raise ValueError("end_date must be after start_date")

    for key, value in update_fields.items():
        setattr(plan, key, value)
    await db.flush()

    if data.days is not None:
        # Taper last so it operates on the final saved set of days.
        plan = await save_plan_days(db, user_id, plan.id, data.days)
        event_id = update_fields.get("event_id")
        if event_id:
            plan = await link_event_and_apply_taper(db, user_id, plan, event_id)
    else:
        event_id = update_fields.get("event_id")
        if event_id:
            plan = await link_event_and_apply_taper(db, user_id, plan, event_id)

    return await _reload_plan(db, plan.id)


async def delete_plan(db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID) -> bool:
    """Delete a plan and its days. Returns False if not found."""
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        return False
    await db.delete(plan)
    await db.flush()
    return True


async def _estimate_strength_volume(
    db: AsyncSession, user_id: uuid.UUID, focus: str | None
) -> float | None:
    """Estimate a planned volume from the athlete's recent sessions.

    Uses the average ``total_volume_kg`` of the last handful of lifting
    sessions (any focus) as a rough proxy.  Falls back to ``None`` when no
    recent data exists so the conformity scorer drops the volume component
    rather than scoring against a made-up number.
    """
    result = await db.execute(
        select(func.avg(LiftingSession.total_volume_kg)).where(
            LiftingSession.user_id == user_id,
            LiftingSession.total_volume_kg.isnot(None),
            LiftingSession.total_volume_kg > 0,
            LiftingSession.session_date >= date.today() - timedelta(days=180),
        )
    )
    avg = result.scalar_one()
    if avg is not None:
        return round(avg, -2)  # round to nearest 100 kg
    return None


async def generate_plan(
    db: AsyncSession, user_id: uuid.UUID, data: GeneratePlanRequest
) -> TrainingPlan:
    """Auto-generate a training plan from a template type.

    Handles all template types including "strength" for user-defined
    progressive-overload strength plans.
    """
    if data.template_type not in VALID_PLAN_TYPES - {"custom"}:
        raise ValueError(
            "Invalid template_type. Must be one of: "
            f"{', '.join(sorted(VALID_PLAN_TYPES - {'custom'}))}"
        )
    if data.weeks < 1 or data.weeks > 24:
        raise ValueError("weeks must be between 1 and 24")
    if data.base_tss < 50 or data.base_tss > 1500:
        raise ValueError("base_tss must be between 50 and 1500")

    end_date = data.start_date + timedelta(weeks=data.weeks) - timedelta(days=1)

    # ── Strength plan: uses user-provided progression template ──────────────
    if data.template_type == "strength":
        focuses = data.strength_focuses if data.strength_focuses else None
        days = _strength_plan_days(
            weeks=data.weeks,
            start_date=data.start_date,
            focuses=focuses,
            template=data.strength_template,
        )
    else:
        days = _generate_plan_days(
            data.template_type, data.weeks, data.start_date, data.base_tss
        )

    # C2 — anchor generated days on the athlete's CURRENT physiology before any
    # explicit overrides below: FTP → cycle targets; current e1RM → strength
    # weights (with a %1RM basis, so refresh-targets can re-solve them later).
    await _personalise_generated_days(db, user_id, days)

    # Backfill planned_volume_kg for strength days by looking at the athlete's
    # recent session history (templates ship with weight_kg=None).
    for day_data in days:
        if day_data.sport == "strength" and day_data.planned_volume_kg is None:
            day_data.planned_volume_kg = await _estimate_strength_volume(
                db, user_id, day_data.planned_focus
            )

    # Apply user-supplied starting stats if provided
    if (
        data.strength_start_rpe is not None
        or data.strength_start_sets is not None
        or data.strength_start_reps is not None
        or data.strength_start_weight_kg is not None
    ):
        for day_data in days:
            if day_data.sport == "strength" and day_data.planned_exercises:
                for ex in day_data.planned_exercises:
                    if data.strength_start_rpe is not None:
                        ex["rpe"] = round(data.strength_start_rpe, 1)
                    if data.strength_start_sets is not None:
                        ex["sets"] = data.strength_start_sets
                    if data.strength_start_reps is not None:
                        ex["reps"] = data.strength_start_reps
                    if data.strength_start_weight_kg is not None:
                        ex["weight_kg"] = round(data.strength_start_weight_kg, 1)

    plan = TrainingPlan(
        user_id=user_id,
        name=data.name,
        description=(f"Auto-generated {data.template_type} plan ({data.weeks} weeks)"),
        start_date=data.start_date,
        end_date=end_date,
        plan_type=data.template_type,
        status="draft",
    )
    db.add(plan)
    await db.flush()

    for day_data in days:
        db.add(TrainingPlanDay(plan_id=plan.id, **day_data.model_dump()))
    await db.flush()

    # Load the days collection before taper (avoid async lazy-load).
    plan = await _reload_plan(db, plan.id)
    if data.event_id:
        plan = await link_event_and_apply_taper(db, user_id, plan, data.event_id)

    return await _reload_plan(db, plan.id)


async def _personalise_generated_days(
    db: AsyncSession,
    user_id: uuid.UUID,
    days: list[TrainingPlanDayCreate],
) -> None:
    """Anchor freshly generated days on the athlete's current physiology (C2).

    - **Cycle days** get power/TSS/zone from the profile FTP via ``plan_workout``
      (so a generated plan is FTP-anchored, not template-only). Existing values
      from the template are preserved.
    - **Strength days** get ``weight_kg`` solved from the current e1RM — via the
      entry's RPE when present, else 75% — carrying a ``pct_1rm`` basis and
      ``weight_source='suggested'`` so ``refresh-targets`` re-solves it later.
      ``planned_volume_kg`` is then computed from the real weights.

    Best-effort: a missing cycling profile, PR or recent set leaves the
    template's values untouched (never a fabricated number).
    """
    from app.models.cycling import CyclingProfile
    from app.services.lifting import resolve_exercise_e1rm, rpe_to_pct

    result = await db.execute(
        select(CyclingProfile).where(CyclingProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    ftp = profile.ftp_watts if profile and profile.ftp_watts else None
    lthr = profile.lactate_threshold_hr if profile else None
    weight_kg = profile.weight_kg if profile else None

    for day_data in days:
        if day_data.sport == "cycle":
            if not ftp or not day_data.planned_duration_min:
                continue
            if day_data.planned_type == "rest":
                continue
            difficulty = _TYPE_TO_DIFFICULTY.get(day_data.planned_type, "z3")
            targets = plan_workout(
                ftp=ftp,
                lthr=lthr,
                weight_kg=weight_kg,
                difficulty=difficulty,
                duration_minutes=day_data.planned_duration_min,
            )
            if targets is None:
                continue
            if day_data.planned_power_watts is None:
                day_data.planned_power_watts = targets.target_power_low
            if day_data.planned_tss is None:
                day_data.planned_tss = targets.target_tss_low
            if day_data.planned_zone is None:
                day_data.planned_zone = difficulty
        elif day_data.sport == "strength" and day_data.planned_exercises:
            for ex in day_data.planned_exercises:
                if not isinstance(ex, dict) or ex.get("weight_kg") is not None:
                    continue
                name = str(ex.get("exercise") or "")
                if not name:
                    continue
                basis, _source = await resolve_exercise_e1rm(db, user_id, name)
                if basis is None:
                    continue
                reps = int(ex.get("reps") or 5)
                rpe = ex.get("rpe")
                pct = rpe_to_pct(reps, float(rpe)) if rpe is not None else 0.75
                ex["weight_kg"] = round(basis * pct, 1)
                ex["pct_1rm"] = round(pct, 3)
                ex["weight_source"] = "suggested"
            total = sum(
                (ex.get("weight_kg") or 0) * (ex.get("sets") or 0) * (ex.get("reps") or 0)
                for ex in day_data.planned_exercises
                if isinstance(ex, dict)
            )
            if total > 0:
                day_data.planned_volume_kg = round(total, 2)


# ── Weekly view (Phase 5B) ────────────────────────────────────────────────

# planned_type → workout-planner difficulty when the day has no explicit zone.
_TYPE_TO_DIFFICULTY = {
    "rest": "z1",
    "easy": "z2",
    "moderate": "z3",
    "hard": "z4",
    "race": "z4",
}

_ZONE_PATTERN = re.compile(r"^z[1-5]$")

# Weather enrichment window — matches the forecast cache coverage
# (past week + upcoming week around today).
_WEATHER_WINDOW_DAYS = 7


def _difficulty_for_day(day: TrainingPlanDay) -> str:
    """Workout-planner difficulty for a cycle day (zone override, else type map)."""
    if day.planned_zone and _ZONE_PATTERN.match(day.planned_zone):
        return day.planned_zone
    return _TYPE_TO_DIFFICULTY.get(day.planned_type, "z3")


# ── FL1: load-coherence propagation ──────────────────────────────────────
# Epsilons shared by the refresh endpoint and the week-view staleness flag:
# a recomputed target only counts as "different" beyond rounding noise when
# power moves >2 W or TSS moves >2.
POWER_STALE_EPS_W = 2.0
TSS_STALE_EPS = 2.0

# CP vs FTP cross-check threshold: >10% divergence is reported, never
# silently re-anchored (zones stay FTP-based until the athlete updates FTP).
CP_FTP_MISMATCH_PCT = 10.0


def targets_stale_for_day(
    day: TrainingPlanDay,
    ftp_watts: float | None,
    lthr: float | None,
) -> bool:
    """True when fresh ``plan_workout`` targets differ from stored ones.

    Pure computation — no DB access. Returns False whenever staleness is
    unevaluable (non-cycle day, no duration, both targets null, no FTP).
    TSS is FTP-independent by formula (duration × IF² × 100), so in practice
    FTP moves surface through the power comparison.
    """
    if day.sport != "cycle":
        return False
    if not day.planned_duration_min:
        return False
    if day.planned_power_watts is None and day.planned_tss is None:
        return False
    if not ftp_watts or ftp_watts <= 0:
        return False
    targets = plan_workout(
        ftp=ftp_watts,
        lthr=lthr,
        weight_kg=None,
        difficulty=_difficulty_for_day(day),
        duration_minutes=day.planned_duration_min,
    )
    if targets is None:
        return False
    if (
        day.planned_power_watts is not None
        and abs(targets.target_power_low - day.planned_power_watts) > POWER_STALE_EPS_W
    ):
        return True
    return (
        day.planned_tss is not None
        and abs(targets.target_tss_low - day.planned_tss) > TSS_STALE_EPS
    )


# C5 — strength staleness epsilon (kg): a %1RM-based weight that moved more than
# half a plate step counts as stale.
WEIGHT_STALE_EPS_KG = 1.0


def strength_targets_stale_for_day(
    day: TrainingPlanDay,
    basis_by_exercise: dict[str, float | None],
) -> bool:
    """True when a %1RM-based strength weight drifted from the current e1RM (C5).

    Pure: ``basis_by_exercise`` maps an entry's raw exercise name to its current
    e1RM (or None). Entries without a ``pct_1rm`` basis — hand-set weights — are
    never stale; that is the manual-override rule (S1).
    """
    if day.sport != "strength" or not day.planned_exercises:
        return False
    for ex in day.planned_exercises:
        if not isinstance(ex, dict):
            continue
        pct = ex.get("pct_1rm")
        weight = ex.get("weight_kg")
        if pct is None or weight is None:
            continue
        basis = basis_by_exercise.get(str(ex.get("exercise") or ""))
        if basis is None:
            continue
        try:
            fresh = round(basis * float(pct), 1)
            if abs(fresh - float(weight)) > WEIGHT_STALE_EPS_KG:
                return True
        except (TypeError, ValueError):
            continue
    return False


async def refresh_cycle_targets(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
) -> dict:
    """Recompute cycle-day targets from the CURRENT profile FTP (FL1).

    For each upcoming (``day_date`` >= today) uncompleted cycle day carrying
    at least one stored target (power/TSS) and the inputs to recompute it
    (a non-rest ``planned_type`` + ``planned_duration_min``), fresh targets
    are derived via ``plan_workout`` with the current FTP. Days whose fresh
    power or TSS differs beyond epsilon are updated in place (both stored
    fields re-anchored to the fresh low-end values, filling a null side
    when the day qualifies via the other).

    Strength days are skipped — %1RM propagation belongs to FL3. Past and
    completed days are never touched.

    Returns a dict matching ``RefreshTargetsResponse``.
    """
    from app.models.cycling import CyclingProfile

    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    result = await db.execute(
        select(CyclingProfile).where(CyclingProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    ftp = profile.ftp_watts if profile and profile.ftp_watts else None
    lthr = profile.lactate_threshold_hr if profile else None

    today = date.today()
    refreshed: list[dict] = []
    stale_but_unchanged: list[uuid.UUID] = []
    strength_days_skipped = 0

    for day in plan.days:
        if day.day_date < today or day.completed:
            continue
        if day.sport == "strength":
            # FL3 (e1RM/RPE autoregulation) owns strength propagation.
            strength_days_skipped += 1
            continue
        if day.sport != "cycle":
            continue
        if day.planned_power_watts is None and day.planned_tss is None:
            continue
        if not day.planned_type or day.planned_type == "rest":
            continue
        if not day.planned_duration_min:
            continue
        if not ftp or ftp <= 0:
            continue
        targets = plan_workout(
            ftp=ftp,
            lthr=lthr,
            weight_kg=profile.weight_kg if profile else None,
            difficulty=_difficulty_for_day(day),
            duration_minutes=day.planned_duration_min,
        )
        if targets is None:
            continue
        if not targets_stale_for_day(day, ftp, lthr):
            stale_but_unchanged.append(day.id)
            continue
        old_power = day.planned_power_watts
        old_tss = day.planned_tss
        day.planned_power_watts = targets.target_power_low
        day.planned_tss = targets.target_tss_low
        refreshed.append(
            {
                "day_id": day.id,
                "day_date": day.day_date,
                "old_power": old_power,
                "new_power": targets.target_power_low,
                "old_tss": old_tss,
                "new_tss": targets.target_tss_low,
            }
        )

    cp_ftp_mismatch = None
    cp = profile.critical_power if profile else None
    if ftp and ftp > 0 and cp and cp > 0:
        pct_diff = abs(cp - ftp) / ftp * 100
        if pct_diff > CP_FTP_MISMATCH_PCT:
            cp_ftp_mismatch = {
                "ftp": ftp,
                "critical_power": cp,
                "pct_diff": round(pct_diff, 1),
            }

    await db.flush()
    return {
        "refreshed": refreshed,
        "stale_but_unchanged": stale_but_unchanged,
        "cp_ftp_mismatch": cp_ftp_mismatch,
        "strength_days_skipped": strength_days_skipped,
    }


# ── FL3: %e1RM strength-target propagation ─────────────────────────────
# A recomputed strength weight only counts as "different" beyond plate-loading
# noise when it moves more than this.
STRENGTH_REFRESH_EPS_KG = 0.5


async def refresh_strength_targets(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
) -> dict:
    """Recompute strength-day weights from the CURRENT e1RMs (FL3).

    For each upcoming (``day_date`` >= today) uncompleted strength day, every
    ``planned_exercises`` entry carrying a ``pct_1rm`` basis is re-solved as
    ``weight_kg = round(e1RM × pct_1rm, 1)`` with the e1RM resolved via
    ``lifting.resolve_exercise_e1rm`` (stored PR first, else best recent set).
    Entries the user set by hand (``weight_source == 'manual'``) are skipped
    even when they carry a basis (S1 §5 — manual always wins), as are entries
    without a basis, entries with an unresolvable e1RM, past and completed
    days, and non-strength days. ``planned_volume_kg`` is re-derived from the
    refreshed list (same rule as ``update_plan_day``).

    Returns ``{"strength_refreshed": [...]}`` matching
    ``RefreshTargetsResponse.strength_refreshed``.
    """
    from app.services.lifting import resolve_exercise_e1rm

    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    today = date.today()
    refreshed: list[dict] = []

    for day in plan.days:
        if day.day_date < today or day.completed:
            continue
        if day.sport != "strength":
            continue
        exercises = day.planned_exercises or []
        if not exercises:
            continue
        new_list: list[dict] = []
        changed = False
        for ex in exercises:
            if not isinstance(ex, dict):
                new_list.append(ex)
                continue
            # S1 §5: manual always wins. An entry the user typed by hand is
            # never re-solved, even though it may still carry a stale pct_1rm
            # from the suggestion it replaced.
            if ex.get("weight_source") == "manual":
                new_list.append(ex)
                continue
            pct = ex.get("pct_1rm")
            if pct is None:
                new_list.append(ex)
                continue
            try:
                pct_f = float(pct)
            except (TypeError, ValueError):
                new_list.append(ex)
                continue
            if not 0 < pct_f <= 1.0:
                new_list.append(ex)
                continue
            basis_1rm, source = await resolve_exercise_e1rm(
                db, user_id, str(ex.get("exercise") or "")
            )
            if basis_1rm is None:
                new_list.append(ex)
                continue
            new_weight = round(basis_1rm * pct_f, 1)
            old_weight = ex.get("weight_kg")
            if old_weight is not None:
                try:
                    if abs(float(old_weight) - new_weight) <= STRENGTH_REFRESH_EPS_KG:
                        new_list.append(ex)
                        continue
                except (TypeError, ValueError):
                    pass
            updated = dict(ex)
            updated["weight_kg"] = new_weight
            new_list.append(updated)
            changed = True
            refreshed.append(
                {
                    "day_id": day.id,
                    "day_date": day.day_date,
                    "exercise": ex.get("exercise"),
                    "old_weight_kg": old_weight,
                    "new_weight_kg": new_weight,
                    "pct_1rm": pct_f,
                    "basis_1rm_kg": round(basis_1rm, 1),
                    "basis_source": source,
                }
            )
        if changed:
            # Reassign (don't mutate in place) so the JSONB column flags dirty.
            day.planned_exercises = new_list
            if any(isinstance(e, dict) and e.get("weight_kg") for e in new_list):
                day.planned_volume_kg = round(
                    sum(
                        (e.get("weight_kg") or 0) * e.get("sets", 0) * e.get("reps", 0)
                        for e in new_list
                        if isinstance(e, dict)
                    ),
                    2,
                )
            else:
                day.planned_volume_kg = None

    await db.flush()
    return {"strength_refreshed": refreshed}


# ── S1: strength progression engine ──────────────────────────────────────
#
# Three operations over one idea: a plan is a *program*, so an exercise's load
# in week N is a function of recent history (the anchor) and the plan's own
# previous weeks (the progression).
#
#   suggest      → proposes weights; writes nothing
#   apply        → writes the ones the user accepted (weight_source='suggested')
#   materialise  → fills per-week sets/reps/RPE cells from the stored rules
#
# Manual always wins: an entry carrying ``weight_source == 'manual'`` is skipped
# by suggest, apply and refresh_strength_targets unless ``force=True``. A
# suggestion is advice, never an overwrite.

# Deload scaling when a rule sets ``deload_every`` but no explicit factor.
DEFAULT_DELOAD_FACTOR = 0.9


def _plan_week1_start(plan: TrainingPlan) -> date:
    """Monday of the week containing the plan's start date (week 1)."""
    return plan.start_date - timedelta(days=plan.start_date.weekday())


def _plan_total_weeks(plan: TrainingPlan) -> int:
    return ((plan.end_date - _plan_week1_start(plan)).days // 7) + 1


def _week_number_for(plan: TrainingPlan, day_date: date) -> int:
    """1-indexed Monday-based week number, matching ``GET /week/{week_number}``."""
    return ((day_date - _plan_week1_start(plan)).days // 7) + 1


def _rules_by_exercise(raw: list | None) -> dict[str, dict]:
    """Index stored progression rules by normalised exercise key.

    Rules are stored as raw JSONB, so every read has to tolerate a malformed
    row (a hand-edited plan, an older payload) rather than raising — a bad rule
    means "no rule", which degrades to the stateless suggestion.
    """
    from app.services.exercise_db import normalise_exercise_name

    out: dict[str, dict] = {}
    for rule in raw or []:
        if not isinstance(rule, dict):
            continue
        name = str(rule.get("exercise") or "").strip()
        if not name:
            continue
        out[normalise_exercise_name(name)] = rule
    return out


def _as_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _rule_targets(
    rule: dict, week: int
) -> tuple[int | None, int | None, float | None, bool]:
    """Resolve one rule's ``(sets, reps, rpe, is_deload)`` for a given week.

    ``is_deload`` is ``week % deload_every == 0``. A deload week **suppresses
    the ramp** — the cell carries the previous week's targets (no increment)
    scaled back (RPE modes lose 1 RPE; load modes are scaled in the resolver),
    and the ramp resumes its normal trajectory the following week.
    """
    start = rule.get("start") or {}
    weekly = rule.get("weekly") or {}
    deload_every = _as_int(rule.get("deload_every"))
    is_deload = bool(deload_every) and week % deload_every == 0

    ramp_weeks = week - 1
    if is_deload:
        ramp_weeks = week - 2  # no increment on the deload week itself
    ramp_weeks = max(0, ramp_weeks)

    sets = _as_int(start.get("sets"))
    reps = _as_int(start.get("reps"))
    rpe = _as_float(start.get("rpe"))

    sets_delta = _as_int(weekly.get("sets_delta"))
    reps_delta = _as_int(weekly.get("reps_delta"))
    rpe_delta = _as_float(weekly.get("rpe_delta"))

    if sets is not None and sets_delta:
        sets = max(1, sets + sets_delta * ramp_weeks)
    if reps is not None and reps_delta:
        reps = max(1, reps + reps_delta * ramp_weeks)
    if rpe is not None and rpe_delta:
        rpe = min(10.0, max(1.0, rpe + rpe_delta * ramp_weeks))
    if is_deload and rpe is not None:
        rpe = max(1.0, rpe - 1.0)
    return sets, reps, rpe, is_deload


def _prescribed_loads_by_week(plan: TrainingPlan) -> dict[tuple[str, int], float]:
    """``{(normalised exercise, week): prescribed kg}`` across the plan.

    The later day in a week wins: if an exercise appears twice, the second
    session is the one the next week chains off. Manual and suggested weights
    are both included — ``load`` mode chains off *what was prescribed*.
    """
    from app.services.exercise_db import normalise_exercise_name

    seen: dict[tuple[str, int], tuple[date, float]] = {}
    for day in plan.days:
        if day.sport != "strength":
            continue
        week = _week_number_for(plan, day.day_date)
        for ex in day.planned_exercises or []:
            if not isinstance(ex, dict):
                continue
            name = str(ex.get("exercise") or "").strip()
            kg = _as_float(ex.get("weight_kg"))
            if not name or kg is None:
                continue
            key = (normalise_exercise_name(name), week)
            current = seen.get(key)
            if current is None or day.day_date >= current[0]:
                seen[key] = (day.day_date, kg)
    return {key: value[1] for key, value in seen.items()}


def _recompute_planned_volume(day: TrainingPlanDay) -> None:
    """Re-derive ``planned_volume_kg`` from the day's exercise list."""
    entries = day.planned_exercises or []
    if any(isinstance(e, dict) and e.get("weight_kg") for e in entries):
        day.planned_volume_kg = round(
            sum(
                (e.get("weight_kg") or 0) * (e.get("sets") or 0) * (e.get("reps") or 0)
                for e in entries
                if isinstance(e, dict)
            ),
            2,
        )
    else:
        day.planned_volume_kg = None


async def suggest_strength_progression(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    scope: str = "plan",
    day_id: uuid.UUID | None = None,
    week: int | None = None,
    force: bool = False,
) -> dict:
    """Propose a working weight per planned exercise — writes nothing (S1 §4.2).

    The anchor is the current e1RM (recent history only, 84-day window), scaled
    by the rule's optional ``training_max_pct``; the progression is either the
    week's RPE (``mode='rpe'``, default) or the previous week's prescribed load
    chained by ``load_delta_pct``/``load_delta_kg`` (``mode='load'``, seeded
    from history when there is no previous week). Deload weeks scale the result
    by ``deload_factor``.

    Every target explains itself: ``basis_1rm_kg``/``basis_source``/
    ``basis_date`` (what it is anchored on), ``pct_1rm``/``prev_week_kg``/
    ``delta_kg``/``mode``/``is_deload`` (how it was derived), and
    ``safety_warning`` when the result is ≥95% of the *true* e1RM. Skipped
    entries carry ``skipped_reason`` instead of a weight:
    ``manual`` | ``no_basis`` | ``reps_too_high`` | ``no_target``.

    ``scope`` limits the pass to one day, one week, or the whole plan. Past and
    completed days are included: this is the program matrix's read, and it must
    describe every week the user is looking at.
    """
    from app.services.exercise_db import normalise_exercise_name
    from app.services.lifting import (
        MAX_REPS_FOR_1RM_PR,
        NEAR_MAXIMAL_LOAD_WARNING,
        NEAR_MAXIMAL_PCT,
        resolve_exercise_e1rm_basis,
        round_to_plate,
        rpe_to_pct,
    )

    if scope not in ("day", "week", "plan"):
        raise ValueError(f"Invalid scope: {scope}")
    if scope == "day" and day_id is None:
        raise ValueError("day_id is required when scope='day'")
    if scope == "week" and week is None:
        raise ValueError("week is required when scope='week'")

    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    days = [d for d in plan.days if d.sport == "strength"]
    if scope == "day":
        if not any(d.id == day_id for d in days):
            raise ValueError("Plan day not found")
        days = [d for d in days if d.id == day_id]
    elif scope == "week":
        days = [d for d in days if _week_number_for(plan, d.day_date) == week]
    days.sort(key=lambda d: d.day_date)

    rules = _rules_by_exercise(plan.strength_progression)
    prescribed = _prescribed_loads_by_week(plan)

    targets: list[dict] = []
    for day in days:
        week_number = _week_number_for(plan, day.day_date)
        for index, ex in enumerate(day.planned_exercises or []):
            if not isinstance(ex, dict):
                continue
            exercise = str(ex.get("exercise") or "")
            base = {
                "day_id": day.id,
                "day_date": day.day_date,
                "week": week_number,
                "exercise_index": index,
                "exercise": exercise,
                "sets": _as_int(ex.get("sets")),
                "reps": _as_int(ex.get("reps")),
                "rpe": _as_float(ex.get("rpe"))
                if ex.get("rpe") is not None
                else _as_float(ex.get("target_rpe")),  # target_rpe: deprecated
            }
            rule = rules.get(normalise_exercise_name(exercise), {})
            mode = rule.get("mode") or "rpe"
            if mode not in ("rpe", "load"):
                mode = "rpe"
            base["mode"] = mode

            if ex.get("weight_source") == "manual" and not force:
                targets.append({**base, "skipped_reason": "manual"})
                continue

            reps = base["reps"]
            rpe = base["rpe"]
            explicit_pct = _as_float(ex.get("pct_1rm"))
            if reps is None or reps < 1 or (rpe is None and explicit_pct is None):
                targets.append({**base, "skipped_reason": "no_target"})
                continue
            if reps > MAX_REPS_FOR_1RM_PR:
                # Brzycki degrades past 12 reps: the estimate is not trustworthy
                # enough to prescribe from, so it is flagged rather than shown.
                targets.append({**base, "skipped_reason": "reps_too_high"})
                continue

            basis = await resolve_exercise_e1rm_basis(db, user_id, exercise)
            if basis.e1rm_kg is None:
                targets.append({**base, "skipped_reason": "no_basis"})
                continue

            training_max_pct = _as_float(rule.get("training_max_pct")) or 1.0
            prescribe_basis = basis.e1rm_kg * training_max_pct
            pct = rpe_to_pct(reps, rpe) if rpe is not None else explicit_pct

            _sets, _reps, _rule_rpe, is_deload = _rule_targets(rule, week_number)
            weekly = rule.get("weekly") or {}
            prev_week_kg = prescribed.get(
                (normalise_exercise_name(exercise), week_number - 1)
            )

            if mode == "load" and prev_week_kg:
                kg = prev_week_kg
                load_pct = _as_float(weekly.get("load_delta_pct"))
                if load_pct:
                    kg *= 1 + load_pct
                load_kg = _as_float(weekly.get("load_delta_kg"))
                if load_kg:
                    kg += load_kg
            else:
                # rpe mode, or load mode with nothing to chain from (seed from
                # history — a new exercise mid-plan has no previous week).
                kg = prescribe_basis * pct

            if is_deload:
                deload_factor = _as_float(rule.get("deload_factor"))
                kg *= deload_factor if deload_factor else DEFAULT_DELOAD_FACTOR

            kg = round_to_plate(kg)
            # Report the fraction the *rounded* weight implies, so a later
            # refresh-targets re-solve reproduces this same number instead of
            # drifting by the plate rounding.
            reported_pct = round(kg / basis.e1rm_kg, 4) if basis.e1rm_kg else None
            safety_warning = (
                NEAR_MAXIMAL_LOAD_WARNING
                if kg / basis.e1rm_kg >= NEAR_MAXIMAL_PCT
                else None
            )

            targets.append(
                {
                    **base,
                    "rpe": rpe,
                    "weight_kg": kg,
                    "pct_1rm": reported_pct,
                    "basis_1rm_kg": round(basis.e1rm_kg, 1),
                    "basis_source": basis.source,
                    "basis_date": basis.basis_date,
                    "training_max_pct": training_max_pct,
                    "prev_week_kg": prev_week_kg,
                    "delta_kg": (
                        round(kg - prev_week_kg, 2)
                        if prev_week_kg is not None
                        else None
                    ),
                    "is_deload": is_deload,
                    "safety_warning": safety_warning,
                    "skipped_reason": None,
                }
            )

    return {"plan_id": plan.id, "targets": targets}


async def apply_strength_progression(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    targets: list[dict],
    force: bool = False,
) -> dict:
    """Write accepted suggestions into day entries (S1 §5).

    Each target addresses one entry by ``(day_id, exercise_index)``. A written
    entry becomes ``weight_source='suggested'`` with the ``pct_1rm`` basis that
    produced it, so ``refresh-targets`` can re-solve it when the e1RM moves.
    Entries the user set by hand (``weight_source == 'manual'``) are skipped
    unless ``force=True`` — manual always wins. One flush for the whole batch,
    so a partial failure cannot leave half a program applied.

    Returns ``{"applied": [...], "skipped": [...]}``; skipped entries carry
    ``skipped_reason`` (``manual`` | ``day_not_found`` | ``index_out_of_range``
    | ``invalid_entry``).
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    days_by_id = {day.id: day for day in plan.days}
    applied: list[dict] = []
    skipped: list[dict] = []
    touched: set[uuid.UUID] = set()

    for target in targets:
        day_id = target.get("day_id")
        index = _as_int(target.get("exercise_index"))
        result = {
            "day_id": day_id,
            "exercise_index": index if index is not None else -1,
            "exercise": "",
            "weight_kg": _as_float(target.get("weight_kg")),
            "pct_1rm": _as_float(target.get("pct_1rm")),
        }
        day = None
        if day_id is not None:
            try:
                day = days_by_id.get(uuid.UUID(str(day_id)))
            except (TypeError, ValueError):
                day = None
        if day is None:
            skipped.append(
                {**result, "applied": False, "skipped_reason": "day_not_found"}
            )
            continue
        exercises = list(day.planned_exercises or [])
        if index is None or index < 0 or index >= len(exercises):
            skipped.append(
                {**result, "applied": False, "skipped_reason": "index_out_of_range"}
            )
            continue
        ex = exercises[index]
        if not isinstance(ex, dict):
            skipped.append(
                {**result, "applied": False, "skipped_reason": "invalid_entry"}
            )
            continue
        result["exercise"] = str(ex.get("exercise") or "")
        result["previous_weight_kg"] = _as_float(ex.get("weight_kg"))
        result["previous_weight_source"] = ex.get("weight_source")
        if ex.get("weight_source") == "manual" and not force:
            skipped.append({**result, "applied": False, "skipped_reason": "manual"})
            continue

        weight_kg = result["weight_kg"]
        if weight_kg is None or weight_kg <= 0:
            skipped.append(
                {**result, "applied": False, "skipped_reason": "invalid_entry"}
            )
            continue

        updated = dict(ex)
        updated["weight_kg"] = weight_kg
        if result["pct_1rm"] is not None:
            updated["pct_1rm"] = result["pct_1rm"]
        updated["weight_source"] = "suggested"
        exercises[index] = updated
        # Reassign (don't mutate in place) so the JSONB column flags dirty.
        day.planned_exercises = exercises
        touched.add(day.id)
        applied.append({**result, "applied": True, "skipped_reason": None})

    for day in plan.days:
        if day.id in touched:
            _recompute_planned_volume(day)

    await db.flush()
    return {"plan_id": plan.id, "applied": applied, "skipped": skipped}


async def materialise_strength_progression(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    rules: list[dict] | None = None,
    weeks: list[int] | None = None,
    mode: str = "fill-empty",
) -> dict:
    """Fill per-week cells from the plan's rules (S1 §3.2).

    For each rule, each target week and each strength day in that week, the
    day's entry for that exercise gets the rule's resolved ``sets``/``reps``/
    ``rpe``. ``mode='fill-empty'`` writes only fields the entry has no value
    for; ``mode='replace'`` overwrites them. Weights are deliberately **not**
    written here — they come from ``suggest`` + ``apply``, so a rule never
    silently overwrites a hand-set load.

    A rule whose exercise does not appear on any strength day in a week is
    reported under ``skipped`` rather than invented onto that day: materialise
    edits the program, it does not add exercises to days that don't train them.

    Supplying ``rules`` persists them on the plan (replacing the stored list);
    omitting them materialises whatever the plan already has.
    """
    from app.services.exercise_db import normalise_exercise_name

    if mode not in ("replace", "fill-empty"):
        raise ValueError(f"Invalid mode: {mode}")

    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    if rules is not None:
        plan.strength_progression = [dict(r) for r in rules if isinstance(r, dict)]

    stored = plan.strength_progression or []
    total_weeks = _plan_total_weeks(plan)
    if weeks:
        target_weeks = sorted({w for w in weeks if 1 <= w <= total_weeks})
    else:
        target_weeks = list(range(1, total_weeks + 1))

    strength_days = [d for d in plan.days if d.sport == "strength"]
    days_by_week: dict[int, list[TrainingPlanDay]] = {}
    for day in strength_days:
        days_by_week.setdefault(_week_number_for(plan, day.day_date), []).append(day)

    entries_updated: list[dict] = []
    skipped: list[dict] = []
    touched: set[uuid.UUID] = set()

    for rule in stored:
        if not isinstance(rule, dict):
            continue
        name = str(rule.get("exercise") or "").strip()
        if not name:
            continue
        key = normalise_exercise_name(name)
        for week in target_weeks:
            sets, reps, rpe, is_deload = _rule_targets(rule, week)
            matched = False
            for day in days_by_week.get(week, []):
                exercises = list(day.planned_exercises or [])
                day_changed = False
                for index, ex in enumerate(exercises):
                    if not isinstance(ex, dict):
                        continue
                    if normalise_exercise_name(str(ex.get("exercise") or "")) != key:
                        continue
                    matched = True
                    updates: dict = {}
                    for field, value in (
                        ("sets", sets),
                        ("reps", reps),
                        ("rpe", rpe),
                    ):
                        if value is None:
                            continue
                        if mode == "fill-empty" and ex.get(field) is not None:
                            continue
                        if ex.get(field) == value:
                            continue
                        updates[field] = value
                    if not updates:
                        continue
                    new_ex = {**ex, **updates}
                    exercises[index] = new_ex
                    day_changed = True
                    entries_updated.append(
                        {
                            "day_id": day.id,
                            "day_date": day.day_date,
                            "week": week,
                            "exercise_index": index,
                            "exercise": str(ex.get("exercise") or ""),
                            "sets": new_ex.get("sets"),
                            "reps": new_ex.get("reps"),
                            "rpe": new_ex.get("rpe"),
                            "is_deload": is_deload,
                        }
                    )
                if day_changed:
                    day.planned_exercises = exercises
                    touched.add(day.id)
            if not matched:
                skipped.append(
                    {"week": week, "exercise": name, "reason": "no_matching_entry"}
                )

    await db.flush()
    return {
        "plan_id": plan.id,
        "rules_saved": len(plan.strength_progression or []),
        "days_updated": len(touched),
        "entries_updated": entries_updated,
        "skipped": skipped,
    }


async def update_plan_day(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
    data: TrainingPlanDayUpdate,
) -> TrainingPlanDay:
    """Apply a partial update to a single plan day (e.g. assign a route).

    Only fields present in the payload are changed; everything else —
    including ``completed`` and linked activity/lifting sessions — is preserved.
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    day = next((d for d in plan.days if d.id == day_id), None)
    if day is None:
        raise ValueError("Training plan day not found")

    updates = data.model_dump(exclude_unset=True)
    if (
        updates.get("planned_type") is not None
        and updates["planned_type"] not in VALID_DAY_TYPES
    ):
        raise ValueError(f"Invalid planned_type: {updates['planned_type']}")

    # Validate planned_route_id if provided (must exist and belong to user)
    route_id = updates.get("planned_route_id")
    if route_id is not None:
        from app.models.route import Route

        result = await db.execute(
            select(Route).where(Route.id == route_id, Route.user_id == user_id)
        )
        if not result.scalar_one_or_none():
            raise ValueError("Route not found or not owned by you")

    # Optional manual linking of an actual (the unplanned strip) — validate
    # ownership so a day can't be pointed at another user's data.
    activity_id = updates.get("activity_id")
    if activity_id is not None:
        result = await db.execute(
            select(Activity).where(
                Activity.id == activity_id, Activity.user_id == user_id
            )
        )
        if not result.scalar_one_or_none():
            raise ValueError("Activity not found or not owned by you")

    lifting_session_id = updates.get("lifting_session_id")
    if lifting_session_id is not None:
        result = await db.execute(
            select(LiftingSession).where(
                LiftingSession.id == lifting_session_id,
                LiftingSession.user_id == user_id,
            )
        )
        if not result.scalar_one_or_none():
            raise ValueError("Lifting session not found or not owned by you")

    # Recompute planned_volume_kg from planned_exercises so the two stay
    # in sync (exercises with weight_kg=None yield None volume).
    if updates.get("planned_exercises") is not None:
        ex_list = updates["planned_exercises"] or []
        if any(ex.get("weight_kg") for ex in ex_list if isinstance(ex, dict)):
            updates["planned_volume_kg"] = round(
                sum(
                    (ex.get("weight_kg") or 0) * ex.get("sets", 0) * ex.get("reps", 0)
                    for ex in ex_list
                    if isinstance(ex, dict)
                ),
                2,
            )
        else:
            updates["planned_volume_kg"] = None

    for key, value in updates.items():
        setattr(day, key, value)
    await db.flush()
    return day


async def get_plan_week(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    week_number: int,
    include_weather: bool = True,
) -> TrainingWeekResponse:
    """Build one Monday-based week of a plan with enrichment.

    Week 1 starts on the Monday of the week containing ``plan.start_date``;
    weeks run to cover ``plan.end_date``. Raises ``ValueError`` for unknown
    plans or out-of-range weeks.

    Enrichment per day:
    - weather + bad-weather badge (forecast cache window: today±7 days),
      best-effort — failures leave weather null;
    - actual activity / lifting session summaries (batched queries);
    - route matches for cycle days with planned duration (max 3), null on
      failure or when no FTP is available.
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    # ── Week window ────────────────────────────────────────────────────────
    week1_start = plan.start_date - timedelta(days=plan.start_date.weekday())
    total_weeks = ((plan.end_date - week1_start).days // 7) + 1
    if week_number < 1 or week_number > total_weeks:
        raise ValueError(
            f"Week {week_number} is outside this plan (weeks 1-{total_weeks})"
        )
    week_start = week1_start + timedelta(weeks=week_number - 1)
    week_end = week_start + timedelta(days=6)

    week_days = sorted(
        (d for d in plan.days if week_start <= d.day_date <= week_end),
        key=lambda d: d.day_date,
    )

    today = date.today()

    # ── Readiness (CTL/ATL/TSB) — same logic as GET /workout-planner/zones ──
    profile = await get_or_create_cycling_profile(db, user_id)
    await db.refresh(profile)

    readiness = None
    daily_tss = await get_daily_tss(
        db, user_id, today - timedelta(days=90 + CTL_WARMUP_DAYS), today
    )
    if daily_tss:
        load_data = compute_training_load(daily_tss, today, lookback_days=90)
        last = load_data[-1]
        rec = get_readiness_recommendation(last["ctl"], last["atl"], last["tsb"])
        readiness = WeekReadiness(
            tsb=rec.current_tsb,
            ctl=rec.current_ctl,
            atl=rec.current_atl,
            recommended_max_zone=rec.recommended_max_zone,
        )

    # ── Weather — resolve coords once, single forecast call ────────────────
    weather_by_date: dict[str, dict] = {}
    if include_weather:
        try:
            coords = await resolve_user_coords(db, user_id)
            if coords:
                forecast = await get_forecast(db, user_id, coords[0], coords[1], days=7)
                weather_by_date = {
                    d.get("date"): d for d in forecast.get("days", []) if d.get("date")
                }
        except Exception as e:
            logger.warning("Weather enrichment skipped for plan %s: %s", plan_id, e)

    # ── Actuals — batched lookups ──────────────────────────────────────────
    activity_ids = {d.activity_id for d in week_days if d.activity_id}
    activities: dict[uuid.UUID, Activity] = {}
    if activity_ids:
        result = await db.execute(
            select(Activity)
            .where(Activity.id.in_(activity_ids))
            .options(selectinload(Activity.route))
        )
        activities = {a.id: a for a in result.scalars().all()}

    lifting_ids = {d.lifting_session_id for d in week_days if d.lifting_session_id}
    lifting_sessions: dict[uuid.UUID, LiftingSession] = {}
    if lifting_ids:
        result = await db.execute(
            select(LiftingSession).where(LiftingSession.id.in_(lifting_ids))
        )
        lifting_sessions = {s.id: s for s in result.scalars().all()}

    # ── Warmup templates — batched lookup ─────────────────────────────────
    warmup_ids = {d.warmup_template_id for d in week_days if d.warmup_template_id}
    warmup_templates: dict[uuid.UUID, WarmupTemplate] = {}
    if warmup_ids:
        result = await db.execute(
            select(WarmupTemplate)
            .where(WarmupTemplate.id.in_(warmup_ids))
            .options(selectinload(WarmupTemplate.steps))
        )
        warmup_templates = {t.id: t for t in result.scalars().all()}

    # ── Route matches — cycle days with a planned duration only ────────────
    route_matches_by_day: dict[uuid.UUID, list[WeekRouteMatch]] = {}
    cycle_days = [
        d for d in week_days if d.sport == "cycle" and (d.planned_duration_min or 0) > 0
    ]
    if cycle_days and profile.ftp_watts and profile.ftp_watts > 0:
        for day in cycle_days:
            duration_min = day.planned_duration_min
            difficulty = _difficulty_for_day(day)
            targets = plan_workout(
                ftp=profile.ftp_watts,
                lthr=profile.lactate_threshold_hr,
                weight_kg=profile.weight_kg,
                difficulty=difficulty,
                duration_minutes=duration_min or 60,
            )
            if targets is None:
                continue
            try:
                match_result = await find_matching_routes(
                    db=db,
                    user_id=user_id,
                    ftp=profile.ftp_watts,
                    difficulty=difficulty,
                    duration_minutes=duration_min,
                    target_tss_low=targets.target_tss_low,
                    target_tss_high=targets.target_tss_high,
                    target_power_low=targets.target_power_low,
                    target_power_high=targets.target_power_high,
                    target_hr_low=targets.target_hr_low,
                    target_hr_high=targets.target_hr_high,
                    max_results=3,
                )
            except Exception as e:
                logger.warning("Route matching failed for plan day %s: %s", day.id, e)
                continue
            route_matches_by_day[day.id] = [
                WeekRouteMatch(
                    route_id=m.route_id,
                    name=m.route_name,
                    score=m.match_score,
                    confidence=m.confidence,
                    estimated_tss=m.avg_tss,
                    ride_count=m.ride_count,
                )
                for m in match_result.matches
            ]

    # ── Assemble enriched day entries ───────────────────────────────────────
    window_lo = today - timedelta(days=_WEATHER_WINDOW_DAYS)
    window_hi = today + timedelta(days=_WEATHER_WINDOW_DAYS)

    # C5 — strength staleness needs the current e1RM per exercise. Resolve each
    # strength exercise in the week ONCE (not per day), so the flag stays cheap.
    from app.services.lifting import resolve_exercise_e1rm

    strength_names: set[str] = set()
    for d in week_days:
        if d.sport == "strength":
            for ex in d.planned_exercises or []:
                if (
                    isinstance(ex, dict)
                    and ex.get("pct_1rm") is not None
                    and ex.get("exercise")
                ):
                    strength_names.add(str(ex["exercise"]))
    basis_by_exercise: dict[str, float | None] = {}
    for name in strength_names:
        basis, _src = await resolve_exercise_e1rm(db, user_id, name)
        basis_by_exercise[name] = basis

    entries: list[TrainingWeekDay] = []
    for day in week_days:
        base = TrainingPlanDayRead.model_validate(day).model_dump()

        weather = None
        bad_weather = None
        wdata = (
            weather_by_date.get(day.day_date.isoformat())
            if include_weather and window_lo <= day.day_date <= window_hi
            else None
        )
        if wdata:
            weather = DayWeather(
                date=wdata.get("date"),
                conditions=wdata.get("conditions"),
                temp_min=wdata.get("temp_min"),
                temp_max=wdata.get("temp_max"),
                precipitation_probability=wdata.get("precipitation_probability"),
                precipitation_sum=wdata.get("precipitation_sum"),
                wind_speed_max=wdata.get("wind_speed_max"),
            )
            bad = is_bad_weather(wdata)
            if bad:
                bad_weather = BadWeather(**bad)

        activity = activities.get(day.activity_id) if day.activity_id else None
        actual_activity = (
            ActualActivity(
                id=activity.id,
                name=activity.name,
                sport_type=activity.sport_type,
                start_date=activity.start_date,
                duration_seconds=activity.duration_seconds,
                distance_meters=activity.distance_meters,
                tss=activity.tss,
                average_power=activity.average_power,
                route_id=activity.route_id,
                route_name=activity.route.name if activity.route else None,
            )
            if activity
            else None
        )

        session = (
            lifting_sessions.get(day.lifting_session_id)
            if day.lifting_session_id
            else None
        )
        actual_lifting = (
            ActualLiftingSession(
                id=session.id,
                session_date=session.session_date,
                focus=session.focus,
                total_volume_kg=session.total_volume_kg,
            )
            if session
            else None
        )

        # Compute day_status for visual indicators
        if day.sport == "rest":
            day_status = "rest"
        elif day.day_date >= today:
            day_status = "pending"
        elif day.completed:
            day_status = "completed"
        elif day.activity_id is not None or day.lifting_session_id is not None:
            day_status = "partial"
        else:
            day_status = "missed"

        # FL1 staleness flag — cheap: profile already loaded, no extra
        # queries per day. Only upcoming uncompleted days can be stale.
        targets_stale = (
            day.day_date >= today
            and not day.completed
            and (
                targets_stale_for_day(
                    day,
                    profile.ftp_watts if profile else None,
                    profile.lactate_threshold_hr if profile else None,
                )
                or strength_targets_stale_for_day(day, basis_by_exercise)
            )
        )

        entries.append(
            TrainingWeekDay(
                **base,
                weather=weather,
                bad_weather=bad_weather,
                actual_activity=actual_activity,
                actual_lifting_session=actual_lifting,
                route_matches=route_matches_by_day.get(day.id),
                warmup_template=_build_warmup_read(
                    warmup_templates.get(day.warmup_template_id)
                )
                if day.warmup_template_id
                else None,
                day_status=day_status,
                targets_stale=targets_stale,
            )
        )

    return TrainingWeekResponse(
        plan_id=plan.id,
        week_number=week_number,
        week_start=week_start,
        week_end=week_end,
        readiness=readiness,
        days=entries,
    )


# ── Warmup template helper ───────────────────────────────────────────────


def _build_warmup_read(template: WarmupTemplate | None) -> WarmupTemplateRead | None:
    """Convert a WarmupTemplate ORM object to the read schema."""
    if template is None:
        return None
    return WarmupTemplateRead(
        id=template.id,
        name=template.name,
        exercise_name=template.exercise_name,
        steps=[
            WarmupStepRead(
                step_number=s.step_number,
                weight_kg=s.weight_kg,
                reps=s.reps,
                notes=s.notes,
            )
            for s in (template.steps or [])
        ],
    )


# ── Copy session to plan day ─────────────────────────────────────────────


async def copy_session_to_plan_day(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
    session_id: uuid.UUID,
) -> TrainingPlanDay:
    """Copy exercises from a past lifting session into a plan day's planned_exercises.

    Groups non-warmup sets by exercise name, counts sets, and uses the max weight
    from the session for each exercise.
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    day = next((d for d in plan.days if d.id == day_id), None)
    if day is None:
        raise ValueError("Training plan day not found")

    # Load the lifting session with its sets
    result = await db.execute(
        select(LiftingSession)
        .where(LiftingSession.id == session_id, LiftingSession.user_id == user_id)
        .options(selectinload(LiftingSession.sets))
    )
    session = result.scalar_one_or_none()
    if not session:
        raise ValueError("Lifting session not found")

    # Group non-warmup sets by exercise name
    exercise_groups: dict[str, list[LiftingSet]] = {}
    for s in session.sets:
        if s.is_warmup:
            continue
        exercise_groups.setdefault(s.exercise_name, []).append(s)

    planned_exercises: list[dict] = []
    for exercise_name, sets in exercise_groups.items():
        planned_exercises.append(
            {
                "exercise": exercise_name,
                "sets": len(sets),
                "reps": sets[0].reps,
                "weight_kg": max(s.weight_kg for s in sets),
                "rpe": max((s.rpe for s in sets if s.rpe is not None), default=None),
            }
        )

    day.planned_exercises = planned_exercises
    day.planned_volume_kg = (
        sum(
            (ex["weight_kg"] or 0) * ex["sets"] * ex["reps"] for ex in planned_exercises
        )
        if any(ex.get("weight_kg") for ex in planned_exercises)
        else None
    )
    if not day.planned_focus and session.focus:
        day.planned_focus = _normalise_focus(session.focus)

    await db.flush()
    return day


async def copy_plan_day(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    source_day_id: uuid.UUID,
    target_date: date,
) -> TrainingPlanDay:
    """Copy a plan day's exercises to a new date within the same plan.

    Creates a new TrainingPlanDay with the same planned_exercises, focus,
    sport, type, and other planned fields, but on the target_date.
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    source = next((d for d in plan.days if d.id == source_day_id), None)
    if source is None:
        raise ValueError("Source training plan day not found")

    # Check target date is within plan range
    if target_date < plan.start_date or target_date > plan.end_date:
        raise ValueError("Target date is outside the plan range")

    # Check if a day already exists at the target date
    existing = next((d for d in plan.days if d.day_date == target_date), None)
    if existing:
        raise ValueError("A plan day already exists at the target date")

    new_day = TrainingPlanDay(
        plan_id=plan.id,
        day_date=target_date,
        sport=source.sport,
        planned_tss=source.planned_tss,
        planned_duration_min=source.planned_duration_min,
        planned_type=source.planned_type,
        workout_description=source.workout_description,
        planned_focus=source.planned_focus,
        planned_exercises=source.planned_exercises,
        planned_volume_kg=source.planned_volume_kg,
        planned_rpe=source.planned_rpe,
        planned_power_watts=source.planned_power_watts,
        planned_zone=source.planned_zone,
        planned_route_id=source.planned_route_id,
        warmup_template_id=source.warmup_template_id,
        notes=source.notes,
    )
    db.add(new_day)
    await db.flush()
    return new_day


# ── FL2: missed-session reconciliation ───────────────────────────────────


class PlanDayConflictError(ValueError):
    """Target date already holds an uncompleted non-rest day (HTTP 409)."""


async def reschedule_plan_day(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
    target_date: date,
) -> TrainingPlanDay:
    """Move an uncompleted (missed/pending) day to ``target_date`` (FL2).

    All planned fields travel with the day; linked actuals (if any) stay
    attached. Raises ``PlanDayConflictError`` when another uncompleted
    non-rest day already occupies the target date, ``ValueError`` for
    unknown plans/days, completed days, or out-of-range targets.
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    day = next((d for d in plan.days if d.id == day_id), None)
    if day is None:
        raise ValueError("Training plan day not found")
    if day.completed:
        raise ValueError("Cannot reschedule a completed day")

    if target_date < plan.start_date or target_date > plan.end_date:
        raise ValueError("Target date is outside the plan range")

    occupant = next(
        (
            d
            for d in plan.days
            if d.id != day.id
            and d.day_date == target_date
            and d.sport != "rest"
            and not d.completed
        ),
        None,
    )
    if occupant is not None:
        raise PlanDayConflictError(
            f"Target date {target_date.isoformat()} already holds an "
            "uncompleted session"
        )

    day.day_date = target_date
    await db.flush()
    return day


async def substitute_plan_day(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
    sport: str,
    planned_type: str,
    overrides: dict | None = None,
) -> TrainingPlanDay:
    """Convert a missed day into an alternate session on the same date (FL2).

    E.g. a missed threshold ride becomes an endurance spin. ``sport`` must be
    one of cycle/strength/rest and ``planned_type`` one of the
    ``VALID_DAY_TYPES`` — anything else raises ``ValueError("Invalid ...")``
    (the router maps these to HTTP 422). Optional ``overrides`` replace the
    matching planned targets (duration/tss/power/volume/rpe); every other
    planned field is preserved. The conversion is recorded in ``notes``.
    Completed days are rejected — substitution is for missed sessions.
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    day = next((d for d in plan.days if d.id == day_id), None)
    if day is None:
        raise ValueError("Training plan day not found")
    if day.completed:
        raise ValueError("Cannot substitute a completed day")

    if sport not in ("cycle", "strength", "rest"):
        raise ValueError(f"Invalid sport: {sport}")
    if planned_type not in VALID_DAY_TYPES:
        raise ValueError(f"Invalid planned_type: {planned_type}")

    old_sport, old_type = day.sport, day.planned_type
    day.sport = sport
    day.planned_type = planned_type

    for key in (
        "planned_duration_min",
        "planned_tss",
        "planned_power_watts",
        "planned_volume_kg",
        "planned_rpe",
    ):
        if overrides and overrides.get(key) is not None:
            setattr(day, key, overrides[key])

    annotation = (
        f"Substituted {old_sport}/{old_type} → {sport}/{planned_type} "
        "(missed session alternate)"
    )
    day.notes = f"{day.notes}; {annotation}" if day.notes else annotation

    await db.flush()
    return day


# ── Editor primitives (add / delete / swap) ──────────────────────────────


async def add_plan_day(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    data: TrainingPlanDayCreate,
) -> TrainingPlanDay:
    """Add a single day to a plan (409 when the date is already used).

    The targeted counterpart to ``save_plan_days``: it never deletes anything,
    so the editor can add one session without rewriting the plan's day set.
    Completed/linked-actual columns are server-managed and never set here.
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    _validate_days([data])

    if data.day_date < plan.start_date or data.day_date > plan.end_date:
        raise ValueError("Day date is outside the plan range")

    if any(d.day_date == data.day_date for d in plan.days):
        raise PlanDayConflictError(
            f"A day already exists on {data.day_date.isoformat()}"
        )

    day = TrainingPlanDay(plan_id=plan.id, **data.model_dump(exclude_none=True))
    db.add(day)
    await db.flush()
    return day


async def delete_plan_day(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
) -> None:
    """Delete a single plan day.

    Completed days are refused (HTTP 400): deleting one would orphan the
    history its linked actual represents.
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    day = next((d for d in plan.days if d.id == day_id), None)
    if day is None:
        raise ValueError("Training plan day not found")
    if day.completed:
        raise ValueError("Cannot delete a completed day")

    await db.delete(day)
    await db.flush()


async def swap_plan_days(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
    target_day_id: uuid.UUID,
) -> tuple[TrainingPlanDay, TrainingPlanDay]:
    """Exchange ``day_date`` between two uncompleted days of one plan.

    A true swap (not two moves): the rows keep their content and linked
    actuals and only trade dates, so it needs no free slot and cannot hit the
    ``reschedule`` 409. ``TrainingPlanDay`` has no UNIQUE ``(plan_id,
    day_date)`` constraint, so this is a plain two-attribute update flushed
    together — no temp-date dance.
    """
    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    day = next((d for d in plan.days if d.id == day_id), None)
    target = next((d for d in plan.days if d.id == target_day_id), None)
    if day is None or target is None:
        raise ValueError("Training plan day not found")
    if day.id == target.id:
        raise ValueError("Cannot swap a day with itself")
    if day.completed or target.completed:
        raise ValueError("Cannot swap a completed day")

    day.day_date, target.day_date = target.day_date, day.day_date
    await db.flush()
    return day, target


async def get_unplanned_actuals(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    days: int = 14,
) -> dict:
    """Activities + lifting sessions in the last ``days`` linked to NO plan day.

    Linkage is whatever ``link_activities_to_plan_days`` records:
    ``TrainingPlanDay.activity_id`` / ``lifting_session_id`` across ALL of
    the user's plans (a session claimed by another plan is not unplanned).
    Returns compact actuals for the FL2 "extra session" surface.
    """
    from datetime import UTC, datetime

    plan = await _get_plan_or_none(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    if days < 1 or days > 90:
        raise ValueError("days must be between 1 and 90")

    today = date.today()
    cutoff = today - timedelta(days=days)

    link_rows = (
        await db.execute(
            select(TrainingPlanDay.activity_id, TrainingPlanDay.lifting_session_id)
            .join(TrainingPlan, TrainingPlan.id == TrainingPlanDay.plan_id)
            .where(TrainingPlan.user_id == user_id)
        )
    ).all()
    linked_activity_ids = {r[0] for r in link_rows if r[0] is not None}
    linked_session_ids = {r[1] for r in link_rows if r[1] is not None}

    cutoff_dt = datetime(cutoff.year, cutoff.month, cutoff.day, tzinfo=UTC)
    act_query = select(Activity).where(
        Activity.user_id == user_id,
        Activity.start_date >= cutoff_dt,
    )
    if linked_activity_ids:
        act_query = act_query.where(Activity.id.notin_(linked_activity_ids))
    act_query = act_query.order_by(Activity.start_date.desc())
    activities = list((await db.execute(act_query)).scalars().all())

    lift_query = select(LiftingSession).where(
        LiftingSession.user_id == user_id,
        LiftingSession.session_date >= cutoff,
    )
    if linked_session_ids:
        lift_query = lift_query.where(LiftingSession.id.notin_(linked_session_ids))
    lift_query = lift_query.order_by(LiftingSession.session_date.desc())
    sessions = list((await db.execute(lift_query)).scalars().all())

    return {
        "plan_id": plan.id,
        "days": days,
        "activities": [
            {
                "id": a.id,
                "name": a.name,
                "sport_type": a.sport_type,
                "start_date": a.start_date,
                "duration_seconds": a.duration_seconds,
                "distance_meters": a.distance_meters,
                "tss": a.tss,
                "average_power": a.average_power,
            }
            for a in activities
        ],
        "lifting_sessions": [
            {
                "id": s.id,
                "session_date": s.session_date,
                "focus": s.focus,
                "total_volume_kg": s.total_volume_kg,
                "duration_seconds": s.duration_seconds,
            }
            for s in sessions
        ],
    }
