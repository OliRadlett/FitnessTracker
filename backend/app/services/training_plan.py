"""Training plan business logic — template generation, non-destructive day upsert,
event linkage with auto-taper, plan CRUD, weekly view enrichment (Phase 5B),
and targeted single-day updates.

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
    "squat", "bench", "deadlift", "overhead_press", "accessories", "full_body",
    "push", "pull", "legs", "upper", "lower",
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


# ── Strength plan generation (user-defined progression) ───────────────────

# Default focus rotation for strength days
_DEFAULT_STRENGTH_FOCUSES = ["squat", "bench", "deadlift"]

# Weight progression step sizes by RPE range (kg)
_RPE_WEIGHT_STEPS = {
    (8.0, 9.0): 5.0,   # RPE 8-9: +5kg
    (9.0, 10.0): 2.5,  # RPE 9-10: +2.5kg
    (7.0, 8.0): 5.0,   # RPE 7-8: +5kg
    (6.0, 7.0): 5.0,   # RPE 6-7: +5kg
}


def _get_weight_step(rpe: float | None) -> float:
    """Weight increment for a given RPE — heavier increments at lower RPE."""
    if rpe is None:
        return 2.5
    for (low, high), step in _RPE_WEIGHT_STEPS.items():
        if low <= rpe < high:
            return step
    return 2.5


def _strength_plan_days(
    weeks: int,
    start_date: date,
    focuses: list[str] | None = None,
    template: list[StrengthWeekTemplate] | None = None,
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
    current_rpe = 8.0
    current_sets = 5
    current_reps = 5
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
                days.append(TrainingPlanDayCreate(
                    day_date=day_date,
                    sport="rest",
                    planned_tss=0,
                    planned_duration_min=0,
                    planned_type="rest",
                ))
            elif dow in (0, 2, 4):  # Mon, Wed, Fri = main strength days
                # Cycle through the focus rotation
                day_focus = focuses[(week + dow // 2) % len(focuses)]
                weight = current_weights.get(day_focus)
                days.append(_strength_day(
                    day_date=day_date,
                    focus=day_focus,
                    variant="main",
                    duration_min=75,
                ))
                # Override RPE/sets/reps on the last set of main exercises
                if days[-1].planned_exercises:
                    for ex in days[-1].planned_exercises:
                        if current_rpe is not None:
                            ex["rpe"] = round(current_rpe, 1)
                        if current_sets is not None:
                            ex["sets"] = current_sets
                        if current_reps is not None and dow == 2:  # Wednesday = rep-focused
                            ex["reps"] = current_reps
                        if weight is not None and ex.get("exercise", "").lower().startswith(day_focus):
                            ex["weight_kg"] = round(weight, 1)
                if template_week:
                    days[-1].workout_description = template_week
            else:  # Tue, Thu, Sat = accessories or light work
                days.append(_strength_day(
                    day_date=day_date,
                    focus=focus,
                    variant="accessories",
                    duration_min=45,
                ))
                if days[-1].planned_exercises:
                    for ex in days[-1].planned_exercises:
                        if current_rpe is not None:
                            ex["rpe"] = round(current_rpe - 1, 1)
                        if current_sets is not None:
                            ex["sets"] = max(2, current_sets - 1)
                        if current_reps is not None:
                            ex["reps"] = current_reps + 2

    return days


# ── Strength suggestion logic (smart weight adjustment for big 3) ──────────

# Conformity threshold for auto-suggesting weight increases (0-100)
SUGGEST_WEIGHT_THRESHOLD = 85.0

# Big 3 exercise canonical names (lowercase, no aliases)
_BIG_3 = {"squat", "bench", "deadlift"}

# Weight increments by RPE proximity
# When actual RPE ≈ planned RPE → perfect, +5kg is safe
# When actual RPE < planned RPE → too easy, +5-10kg
# When actual RPE > planned RPE → too hard, stay or +2.5kg
_STEP_WELL_EASY = 5.0    # RPE 0.5+ below target
_STEP_WELL_MATCH = 2.5   # RPE within ±0.5 of target
_STEP_STRUGGLING = 0.0   # RPE > planned RPE + 0.5 (maintain weight)


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
    upcoming days:

    - actual RPE within ±0.5 of planned → perfect, +2.5kg
    - actual RPE > planned RPE + 0.5 → user struggled, maintain weight
    - actual RPE < planned RPE - 0.5 → user had capacity, +5kg

    Only suggests for exercises present in both the completed day and an
    upcoming day.
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
    from app.models.lifting import LiftingSession
    from app.services.conformity import get_day_conformity

    completed_days: list[tuple[TrainingPlanDay, dict]] = []
    for day in reversed(strength_days):  # most recent first
        if day.day_date < today and day.lifting_session_id:
            try:
                conformity = await get_day_conformity(
                    db, user_id, plan_id, day.id
                )
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
    # For each big 3 exercise, capture: planned RPE (from plan day),
    # actual RPE (from session sets), completed weight
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
            s for s in session.sets
            if _classify_big3_exercise(s.exercise_name) == big3_name
        ]

        if not matching_sets:
            continue

        # For the main working sets (non-warmup), compute:
        # - last set RPE (indicator of difficulty)
        # - average weight used
        working_sets = [s for s in matching_sets if not s.is_warmup]
        if not working_sets:
            continue

        # Use the heaviest set's RPE (primary indicator)
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
        d for d in strength_days
        if d.day_date >= today and d.planned_exercises
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

        for planned_ex in (up_day.planned_exercises or []):
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
            rpe_gap = actual_rpe - planned_rpe  # positive = struggled, negative = had room

            if rpe_gap > 0.5:
                # User struggled — suggest maintaining weight
                suggested_weight = round(completed_weight, 1)
                reason = f"RPE was {actual_rpe} (planned {planned_rpe}) — maintaining"
            elif rpe_gap < -0.5:
                # User had capacity — suggest +5kg
                suggested_weight = round(completed_weight + _STEP_WELL_EASY, 1)
                reason = f"RPE was {actual_rpe} (planned {planned_rpe}) — adding load"
            else:
                # RPE matched well — suggest +2.5kg
                suggested_weight = round(completed_weight + _STEP_WELL_MATCH, 1)
                reason = f"RPE was {actual_rpe} (planned {planned_rpe}) — matched well"

            ex_suggestions.append({
                "exercise_name": planned_ex.get("exercise", ""),
                "old_weight_kg": upcoming_weight,
                "suggested_weight_kg": suggested_weight,
                "rpe": actual_rpe,
                "sets": planned_ex.get("sets", 0),
                "reps": planned_ex.get("reps", 0),
            })

        if ex_suggestions:
            suggestions.append({
                "day_id": str(up_day.id),
                "day_date": up_day.day_date.isoformat(),
                "sport": "strength",
                "planned_focus": up_day.planned_focus,
                "exercises": ex_suggestions,
            })
            summary_parts.append(f"  • {up_day.day_date}: {len(ex_suggestions)} exercises")

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


# ── Day persistence (non-destructive upsert) ─────────────────────────────


async def save_plan_days(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    days: list[TrainingPlanDayCreate],
) -> TrainingPlan:
    """Upsert plan days matched by ``day_date`` — never wipes data wholesale.

    - Existing dates: update provided fields only (completed / activity_id /
      lifting_session_id are preserved unless explicitly included in payload).
    - New dates: insert.
    - Missing dates: delete.
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
                    needs_fill = (row.planned_tss is None) or (row.planned_power_watts is None)
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
    """Update a plan. Days, if provided, are saved non-destructively."""
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
        select(func.avg(LiftingSession.total_volume_kg))
        .where(
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
        description=(
            f"Auto-generated {data.template_type} plan "
            f"({data.weeks} weeks)"
        ),
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
    daily_tss = await get_daily_tss(db, user_id, today - timedelta(days=90), today)
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
    day.planned_volume_kg = sum(
        (ex["weight_kg"] or 0) * ex["sets"] * ex["reps"]
        for ex in planned_exercises
    ) if any(ex.get("weight_kg") for ex in planned_exercises) else None
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
