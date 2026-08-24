"""Planned-cycle & strength conformity scoring (Phase 5C).

Pure scoring helpers are unit-testable without a database; the async
functions at the bottom follow the ``(db: AsyncSession, user_id, ...)``
service convention.

Scoring model
-------------
Each comparable metric yields ``score_component`` ∈ [0, 1] =
``1 − |planned − actual| / planned`` (clamped). Included components have
their raw weights renormalised so they always sum to 1.0; the overall
score is the weighted mean × 100.

Classification: ≥90 Excellent · ≥70 Good · ≥50 Partial deviation ·
else Significant deviation.

Day statuses:
- ``done``    — scored ≥50 with an actual
- ``partial`` — scored <50 with an actual
- ``missed``  — past day with no linked actual
- ``extra``   — actual present but no comparable planned targets
- ``pending`` — future day that hasn't happened yet (single-day endpoint only)
"""

import logging
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity
from app.models.lifting import LiftingSession, LiftingSet
from app.models.training_plan import TrainingPlan, TrainingPlanDay

logger = logging.getLogger(__name__)

# ── Weights ───────────────────────────────────────────────────────────────

# NO HR component — TrainingPlanDay has no planned_hr column.
CYCLE_WEIGHTS = {
    "duration": 0.25,
    "power": 0.30,
    "tss": 0.20,
    "route": 0.10,
}

STRENGTH_WEIGHTS = {
    "volume": 0.35,
    "exercises": 0.30,
    "duration": 0.15,
    "rpe": 0.10,
    "focus": 0.10,
}

# Deviations larger than this (percent) produce human-readable callouts.
DEVIATION_THRESHOLD_PCT = 8.0

# Auto-linking window: actuals up to this many days back are matched.
LINK_LOOKBACK_DAYS = 14


# ── Pure scoring helpers ──────────────────────────────────────────────────


def score_component(planned: float | None, actual: float | None) -> float | None:
    """Relative-match score in [0, 1]; None when either side is missing/≤0."""
    if planned is None or actual is None:
        return None
    if planned <= 0 or actual <= 0:
        return None
    return max(0.0, min(1.0, 1 - abs(planned - actual) / planned))


def classify_conformity(score_pct: float | None) -> str | None:
    """Bucket a percentage score into a human classification."""
    if score_pct is None:
        return None
    if score_pct >= 90:
        return "Excellent"
    if score_pct >= 70:
        return "Good"
    if score_pct >= 50:
        return "Partial deviation"
    return "Significant deviation"


def _component(
    metric: str,
    planned: float | None,
    actual: float | None,
    score: float | None,
    weight: float,
    unit: str = "",
) -> dict:
    """Normalise one candidate component's internal dict."""
    deviation_pct = None
    if score is not None and planned and actual is not None:
        deviation_pct = round((actual - planned) / planned * 100, 1)
    return {
        "metric": metric,
        "planned": planned,
        "actual": actual,
        "deviation_pct": deviation_pct,
        "component_score": round(score, 4) if score is not None else None,
        "_raw_weight": weight,
        "_unit": unit,
    }


def _deviation_text(comp: dict) -> str | None:
    """Human sentence for a component deviating beyond the threshold."""
    dev = comp.get("deviation_pct")
    if dev is None or abs(dev) <= DEVIATION_THRESHOLD_PCT:
        return None
    p, a = comp.get("planned"), comp.get("actual")
    over = dev > 0
    metric = comp["metric"]
    if metric == "duration":
        verb = "longer" if over else "shorter"
        return f"You rode {abs(dev):.0f}% {verb} than planned ({a:.0f}min vs {p:.0f}min target)"
    if metric == "power":
        verb = "harder" if over else "easier"
        return f"You rode {abs(dev):.0f}% {verb} than planned ({a:.0f}W vs {p:.0f}W target)"
    if metric == "tss":
        verb = "above" if over else "below"
        return f"TSS came in {abs(dev):.0f}% {verb} plan ({a:.0f} vs {p:.0f})"
    if metric == "volume":
        pct_of_plan = a / p * 100 if p else dev + 100
        return f"{pct_of_plan:.0f}% of planned volume ({a:.0f}kg vs {p:.0f}kg target)"
    if metric == "exercises":
        return f"{a:.0f} of {p:.0f} planned exercises completed"
    if metric == "rpe":
        verb = "higher" if over else "lower"
        return f"RPE was {abs(dev):.0f}% {verb} than planned ({a} vs {p})"
    return None


def _assemble(components: list[dict]) -> dict:
    """Renormalise weights over scored components; compute overall result.

    Every attempted component is carried through in ``components`` so the
    caller can see what was compared; only scored ones contribute weight.
    """
    scored = [c for c in components if c["component_score"] is not None]
    total_weight = sum(c["_raw_weight"] for c in scored)

    out_components = [
        {
            "metric": c["metric"],
            "planned": c["planned"],
            "actual": c["actual"],
            "deviation_pct": c["deviation_pct"],
            "weight_used": (
                round(c["_raw_weight"] / total_weight, 4)
                if c["component_score"] is not None and total_weight > 0
                else None
            ),
            "component_score": c["component_score"],
        }
        for c in components
    ]

    result: dict = {
        "conformity_pct": None,
        "classification": None,
        "components": out_components,
        "status": "extra",
        "deviations": [],
    }

    if not scored or total_weight <= 0:
        return result

    overall = min(
        100.0,
        sum(c["component_score"] * (c["_raw_weight"] / total_weight) for c in scored)
        * 100,
    )
    result["conformity_pct"] = round(overall, 1)
    result["classification"] = classify_conformity(overall)
    result["status"] = "done" if overall >= 50 else "partial"
    result["deviations"] = [t for c in scored if (t := _deviation_text(c))]
    return result


def missed_conformity() -> dict:
    """Shape returned for a past planned day with no linked actual."""
    return {
        "conformity_pct": None,
        "classification": None,
        "components": [],
        "status": "missed",
        "deviations": [],
    }


def pending_conformity() -> dict:
    """Shape for a future planned day that hasn't happened yet."""
    return {
        "conformity_pct": None,
        "classification": None,
        "components": [],
        "status": "pending",
        "deviations": [],
    }


# ── Cycle conformity ──────────────────────────────────────────────────────


def build_cycle_conformity(day_planned: dict, actual_activity) -> dict | None:
    """Score a planned cycle day against its linked activity.

    ``day_planned`` keys: ``planned_duration_min``, ``planned_power_watts``,
    ``planned_tss``, ``planned_route_id``. Returns None when there is no
    actual activity (callers render missed/pending days themselves).

    Route scoring: 1.0 when the ride used the planned route, 0.5 when it
    used a different route, and the component is dropped (weights
    renormalise) when the ride has no route at all.
    """
    if actual_activity is None:
        return None

    components: list[dict] = []

    # Duration — minutes on both sides
    actual_min = (
        actual_activity.duration_seconds / 60.0
        if actual_activity.duration_seconds
        else None
    )
    planned_min = day_planned.get("planned_duration_min")
    components.append(
        _component(
            "duration",
            float(planned_min) if planned_min else None,
            actual_min,
            score_component(float(planned_min) if planned_min else None, actual_min),
            CYCLE_WEIGHTS["duration"],
            unit="min",
        )
    )

    # Power — prefer normalised power over average power
    actual_power = actual_activity.normalized_power or actual_activity.average_power
    planned_power = day_planned.get("planned_power_watts")
    components.append(
        _component(
            "power",
            float(planned_power) if planned_power else None,
            actual_power,
            score_component(
                float(planned_power) if planned_power else None, actual_power
            ),
            CYCLE_WEIGHTS["power"],
            unit="W",
        )
    )

    # TSS
    planned_tss = day_planned.get("planned_tss")
    components.append(
        _component(
            "tss",
            float(planned_tss) if planned_tss else None,
            actual_activity.tss,
            score_component(
                float(planned_tss) if planned_tss else None,
                actual_activity.tss,
            ),
            CYCLE_WEIGHTS["tss"],
        )
    )

    # Route — only comparable when a route was actually planned
    planned_route_id = day_planned.get("planned_route_id")
    if planned_route_id is not None and actual_activity.route_id is not None:
        matched = actual_activity.route_id == planned_route_id
        components.append(
            _component(
                "route",
                1.0,
                1.0 if matched else 0.5,
                1.0 if matched else 0.5,
                CYCLE_WEIGHTS["route"],
            )
        )
    # planned route but no activity route → dropped entirely (renormalises)

    return _assemble(components)


# ── Strength conformity ───────────────────────────────────────────────────


def _exercise_match(planned_name: str, session_names: list[str]) -> bool:
    """Case-insensitive substring match in either direction."""
    pn = planned_name.lower().strip()
    for name in session_names:
        sn = name.lower().strip()
        if pn and sn and (pn in sn or sn in pn):
            return True
    return False


def build_strength_conformity(
    planned: dict,
    lifting_session,
    session_exercise_names: list[str],
) -> dict | None:
    """Score a planned strength day against its linked lifting session.

    ``planned`` keys: ``planned_volume_kg``, ``planned_exercises`` (list of
    exercise dicts with an ``exercise``/name key), ``planned_duration_min``,
    ``planned_rpe``, ``planned_focus``. Returns None without a session.

    Volume over-performance caps at 120% of target.
    """
    if lifting_session is None:
        return None

    components: list[dict] = []

    # Volume — over-performance earns up to 120% credit, under-performance
    # scales linearly toward 0.
    planned_vol = planned.get("planned_volume_kg")
    actual_vol = lifting_session.total_volume_kg
    vol_score = None
    if planned_vol and planned_vol > 0 and actual_vol is not None:
        vol_score = max(0.0, min(actual_vol, planned_vol * 1.2) / planned_vol)
    components.append(
        _component(
            "volume",
            float(planned_vol) if planned_vol else None,
            actual_vol,
            vol_score,
            STRENGTH_WEIGHTS["volume"],
            unit="kg",
        )
    )

    # Exercises completed — fraction of planned exercises performed
    planned_exercises = planned.get("planned_exercises") or []
    names_lower = [e for e in session_exercise_names]
    ex_score = None
    completed_count = 0
    if planned_exercises and names_lower:
        planned_names = []
        for ex in planned_exercises:
            name = (
                ex.get("exercise") or ex.get("name") or ""
                if isinstance(ex, dict)
                else str(ex)
            )
            if name:
                planned_names.append(name)
        if planned_names:
            completed_count = sum(
                1 for n in planned_names if _exercise_match(n, names_lower)
            )
            ex_score = completed_count / len(planned_names)
            components.append(
                _component(
                    "exercises",
                    float(len(planned_names)),
                    float(completed_count),
                    ex_score,
                    STRENGTH_WEIGHTS["exercises"],
                )
            )

    # Duration — minutes
    planned_dur = planned.get("planned_duration_min")
    actual_dur = (
        lifting_session.duration_seconds / 60.0
        if lifting_session.duration_seconds
        else None
    )
    components.append(
        _component(
            "duration",
            float(planned_dur) if planned_dur else None,
            actual_dur,
            score_component(float(planned_dur) if planned_dur else None, actual_dur),
            STRENGTH_WEIGHTS["duration"],
            unit="min",
        )
    )

    # RPE — within ±1 scores full; beyond that decays linearly to 0 at ±3
    planned_rpe = planned.get("planned_rpe")
    actual_rpe = lifting_session.rpe_session
    rpe_score = None
    if planned_rpe is not None and actual_rpe is not None:
        diff = abs(actual_rpe - planned_rpe)
        rpe_score = 1.0 if diff <= 1 else max(0.0, 1 - (diff - 1) / 2)
    components.append(
        _component(
            "rpe",
            float(planned_rpe) if planned_rpe is not None else None,
            actual_rpe,
            rpe_score,
            STRENGTH_WEIGHTS["rpe"],
        )
    )

    # Focus — substring match either direction, case-insensitive
    planned_focus = planned.get("planned_focus")
    actual_focus = lifting_session.focus
    focus_score = None
    if planned_focus and actual_focus:
        pf, af = planned_focus.lower(), actual_focus.lower()
        focus_score = 1.0 if (pf in af or af in pf) else 0.0
        components.append(
            _component(
                "focus",
                1.0,
                focus_score,
                focus_score,
                STRENGTH_WEIGHTS["focus"],
            )
        )

    return _assemble(components)


# ── Day-level result (DB-facing) ──────────────────────────────────────────


async def _session_exercise_names(
    db: AsyncSession, session_ids: set[uuid.UUID]
) -> dict[uuid.UUID, list[str]]:
    """Exercise names per lifting session id (batched)."""
    if not session_ids:
        return {}
    result = await db.execute(
        select(LiftingSet.session_id, LiftingSet.exercise_name).where(
            LiftingSet.session_id.in_(session_ids)
        )
    )
    names: dict[uuid.UUID, list[str]] = {}
    for sid, name in result.all():
        names.setdefault(sid, []).append(name)
    return names


async def compute_day_conformity(
    day: TrainingPlanDay,
    activities: dict[uuid.UUID, Activity],
    lifting_sessions: dict[uuid.UUID, LiftingSession],
    exercise_names: dict[uuid.UUID, list[str]],
    today: date,
) -> dict:
    """Conformity result for one plan day given pre-fetched actuals."""
    if day.sport == "cycle":
        activity = activities.get(day.activity_id) if day.activity_id else None
        if activity is not None:
            result = build_cycle_conformity(
                {
                    "planned_duration_min": day.planned_duration_min,
                    "planned_power_watts": day.planned_power_watts,
                    "planned_tss": day.planned_tss,
                    "planned_route_id": day.planned_route_id,
                },
                activity,
            )
        elif day.day_date < today:
            result = missed_conformity()
        else:
            result = pending_conformity()
    elif day.sport == "strength":
        session = (
            lifting_sessions.get(day.lifting_session_id)
            if day.lifting_session_id
            else None
        )
        if session is not None:
            result = build_strength_conformity(
                {
                    "planned_volume_kg": day.planned_volume_kg,
                    "planned_exercises": day.planned_exercises,
                    "planned_duration_min": day.planned_duration_min,
                    "planned_rpe": day.planned_rpe,
                    "planned_focus": day.planned_focus,
                },
                session,
                exercise_names.get(session.id, []),
            )
        elif day.day_date < today:
            result = missed_conformity()
        else:
            result = pending_conformity()
    else:  # rest days are never scored
        result = pending_conformity()
        result["status"] = "rest"
    return result


# ── Auto-linking ──────────────────────────────────────────────────────────


async def link_activities_to_plan_days(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID | None = None,
) -> int:
    """Fill ``TrainingPlanDay.activity_id`` / ``lifting_session_id`` gaps.

    Matches within the last 14 days:
    - cycle days ↔ activities whose ``start_date.date() == day_date``
    - strength days ↔ lifting sessions on ``session_date == day_date``,
      requiring ``focus == planned_focus`` when both sides set a focus.

    Only *active* plans are processed (or the single given plan). Returns
    the number of links created; the caller owns the commit.
    """
    from datetime import UTC, datetime

    query = (
        select(TrainingPlan)
        .where(
            TrainingPlan.user_id == user_id,
            TrainingPlan.status == "active",
        )
        .options(selectinload(TrainingPlan.days))
        # Repopulate relationships even when plan objects are already in the
        # session's identity map — otherwise freshly added-but-not-appended
        # days would be invisible to the link pass.
        .execution_options(populate_existing=True)
    )
    if plan_id is not None:
        query = query.where(TrainingPlan.id == plan_id)
    plans = (await db.execute(query)).scalars().unique().all()

    today = date.today()
    cutoff = today - timedelta(days=LINK_LOOKBACK_DAYS)

    # Activities in the window, grouped by calendar date.
    act_result = await db.execute(
        select(Activity)
        .where(
            Activity.user_id == user_id,
            Activity.start_date
            >= datetime(cutoff.year, cutoff.month, cutoff.day, tzinfo=UTC),
        )
        .order_by(Activity.start_date)
    )
    activities_by_date: dict[date, list[Activity]] = {}
    for activity in act_result.scalars():
        activities_by_date.setdefault(activity.start_date.date(), []).append(activity)

    # Lifting sessions in the window, grouped by date then focus.
    lift_result = await db.execute(
        select(LiftingSession)
        .where(LiftingSession.user_id == user_id, LiftingSession.session_date >= cutoff)
        .order_by(LiftingSession.session_date)
    )
    sessions_by_date: dict[date, list[LiftingSession]] = {}
    for session in lift_result.scalars():
        sessions_by_date.setdefault(session.session_date, []).append(session)

    used_activity_ids: set[uuid.UUID] = {
        d.activity_id for plan in plans for d in plan.days if d.activity_id
    }
    used_session_ids: set[uuid.UUID] = {
        d.lifting_session_id for plan in plans for d in plan.days if d.lifting_session_id
    }

    linked = 0
    for plan in plans:
        for day in plan.days:
            if day.sport == "cycle" and day.activity_id is None:
                candidates = [
                    a
                    for a in activities_by_date.get(day.day_date, [])
                    if a.id not in used_activity_ids
                ]
                if candidates:
                    day.activity_id = candidates[0].id
                    used_activity_ids.add(candidates[0].id)
                    linked += 1
            elif day.sport == "strength" and day.lifting_session_id is None:
                candidates = [
                    s
                    for s in sessions_by_date.get(day.day_date, [])
                    if s.id not in used_session_ids
                    # When both sides declare a focus it must match.
                    and not (
                        day.planned_focus
                        and s.focus
                        and day.planned_focus.lower() != s.focus.lower()
                    )
                ]
                if candidates:
                    day.lifting_session_id = candidates[0].id
                    used_session_ids.add(candidates[0].id)
                    linked += 1

    if linked:
        await db.flush()
    return linked


# ── Plan-level aggregation ────────────────────────────────────────────────


def _week_bounds(plan: TrainingPlan) -> tuple[list[tuple[int, date, date]], int]:
    """Monday-aligned week windows covering the plan (same math as get_plan_week)."""
    week1_start = plan.start_date - timedelta(days=plan.start_date.weekday())
    total_weeks = ((plan.end_date - week1_start).days // 7) + 1
    weeks = []
    for n in range(1, total_weeks + 1):
        start = week1_start + timedelta(weeks=n - 1)
        weeks.append((n, start, start + timedelta(days=6)))
    return weeks, total_weeks


async def _get_plan_fresh(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
) -> TrainingPlan | None:
    """Load a plan with its days, forcing a refresh of the days collection.

    ``populate_existing`` avoids stale identity-map collections when plan
    days were created/linked earlier in the same session.
    """
    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.id == plan_id, TrainingPlan.user_id == user_id)
        .options(selectinload(TrainingPlan.days))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def get_plan_conformity(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    weeks: int | None = None,
) -> dict:
    """Weekly conformity aggregate with trend + pattern heuristics.

    ``weeks`` optionally restricts output to the last N weeks that have
    scored days.
    """
    plan = await _get_plan_fresh(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    today = date.today()

    # Batch-fetch actuals referenced by the plan's days.
    activity_ids = {d.activity_id for d in plan.days if d.activity_id}
    activities: dict[uuid.UUID, Activity] = {}
    if activity_ids:
        rows = await db.execute(select(Activity).where(Activity.id.in_(activity_ids)))
        activities = {a.id: a for a in rows.scalars().all()}

    session_ids = {d.lifting_session_id for d in plan.days if d.lifting_session_id}
    lifting_sessions: dict[uuid.UUID, LiftingSession] = {}
    if session_ids:
        rows = await db.execute(
            select(LiftingSession).where(LiftingSession.id.in_(session_ids))
        )
        lifting_sessions = {s.id: s for s in rows.scalars().all()}
    exercise_names = await _session_exercise_names(db, session_ids)

    week_windows, _total = _week_bounds(plan)
    weekly_rows: list[dict] = []
    all_scored_pcts: list[float] = []

    # Per-day detail retained for pattern heuristics.
    cycle_power_devs_hard: list[float] = []
    cycle_duration_devs: list[float] = []
    strength_volume_ratios: list[float] = []

    for week_number, week_start, week_end in week_windows:
        week_days = sorted(
            (d for d in plan.days if week_start <= d.day_date <= week_end),
            key=lambda d: d.day_date,
        )
        scorable = [d for d in week_days if d.sport in ("cycle", "strength")]
        scored_pcts: list[float] = []
        cycle_pcts: list[float] = []
        strength_pcts: list[float] = []

        for day in scorable:
            result = await compute_day_conformity(
                day, activities, lifting_sessions, exercise_names, today
            )
            pct = result.get("conformity_pct")
            if pct is not None:
                scored_pcts.append(pct)
                all_scored_pcts.append(pct)
                if day.sport == "cycle":
                    cycle_pcts.append(pct)
                else:
                    strength_pcts.append(pct)

                # Pattern inputs
                if day.sport == "cycle":
                    for comp in result["components"]:
                        if (
                            comp["metric"] == "power"
                            and comp["deviation_pct"] is not None
                            and day.planned_type == "hard"
                        ):
                            cycle_power_devs_hard.append(comp["deviation_pct"])
                    for comp in result["components"]:
                        if comp["metric"] == "duration" and comp["deviation_pct"] is not None:
                            cycle_duration_devs.append(comp["deviation_pct"])
                elif day.sport == "strength":
                    planned_vol = day.planned_volume_kg or 0
                    session = lifting_sessions.get(day.lifting_session_id)
                    actual_vol = session.total_volume_kg if session else None
                    if planned_vol > 0 and actual_vol is not None:
                        strength_volume_ratios.append(actual_vol / planned_vol)

        weekly_rows.append(
            {
                "week_number": week_number,
                "week_start": week_start,
                "week_end": week_end,
                "days_scored": len(scored_pcts),
                "days_total": len(scorable),
                "pct": round(sum(scored_pcts) / len(scored_pcts), 1)
                if scored_pcts
                else None,
                "by_sport": {
                    "cycle": round(sum(cycle_pcts) / len(cycle_pcts), 1)
                    if cycle_pcts
                    else None,
                    "strength": round(sum(strength_pcts) / len(strength_pcts), 1)
                    if strength_pcts
                    else None,
                },
            }
        )

    # Restrict to last N weeks with data when requested.
    if weeks is not None and weeks >= 1:
        weeks_with_data = [w for w in weekly_rows if w["days_scored"] > 0]
        if weeks_with_data:
            weekly_rows = weeks_with_data[-weeks:]
        else:
            weekly_rows = weekly_rows[-weeks:]

    overall_pct = (
        round(sum(all_scored_pcts) / len(all_scored_pcts), 1)
        if all_scored_pcts
        else None
    )

    trend = None
    if len(all_scored_pcts) >= 2:
        last_week_pct = next(
            (w["pct"] for w in reversed(weekly_rows) if w["pct"] is not None), None
        )
        prior_scores = all_scored_pcts[:-1]
        prior_pct = sum(prior_scores) / len(prior_scores)
        if last_week_pct is not None:
            delta = last_week_pct - prior_pct
            if delta > 3:
                trend = "improving"
            elif delta < -3:
                trend = "declining"
            else:
                trend = "stable"

    patterns: list[str] = []
    if cycle_power_devs_hard:
        avg_power_dev = sum(cycle_power_devs_hard) / len(cycle_power_devs_hard)
        if avg_power_dev > 10:
            patterns.append(
                f"You're riding {avg_power_dev:.0f}% harder than target on hard "
                "cycle days on average — consider raising planned power."
            )
    if strength_volume_ratios:
        short_sessions = sum(1 for r in strength_volume_ratios if r < 0.8)
        share = short_sessions / len(strength_volume_ratios)
        if share >= 0.6:
            patterns.append(
                f"Lift volume fell below 80% of plan on {share * 100:.0f}% of "
                "scored strength sessions."
            )
    if cycle_duration_devs:
        longer_rides = sum(1 for d in cycle_duration_devs if d > 0)
        if longer_rides / len(cycle_duration_devs) > 0.5:
            patterns.append(
                f"{longer_rides} of {len(cycle_duration_devs)} rides ran longer "
                "than planned — durations may be under-estimated."
            )

    return {
        "plan_id": plan.id,
        "overall_pct": overall_pct,
        "trend": trend,
        "weeks": weekly_rows,
        "patterns": patterns,
    }


async def get_day_conformity(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    day_id: uuid.UUID,
) -> dict:
    """Conformity result for a single plan day."""
    plan = await _get_plan_fresh(db, user_id, plan_id)
    if not plan:
        raise ValueError("Training plan not found")

    day = next((d for d in plan.days if d.id == day_id), None)
    if day is None:
        raise ValueError("Training plan day not found")

    activity_ids = {day.activity_id} if day.activity_id else set()
    activities: dict[uuid.UUID, Activity] = {}
    if activity_ids:
        rows = await db.execute(select(Activity).where(Activity.id.in_(activity_ids)))
        activities = {a.id: a for a in rows.scalars().all()}

    session_ids = {day.lifting_session_id} if day.lifting_session_id else set()
    lifting_sessions: dict[uuid.UUID, LiftingSession] = {}
    if session_ids:
        rows = await db.execute(
            select(LiftingSession).where(LiftingSession.id.in_(session_ids))
        )
        lifting_sessions = {s.id: s for s in rows.scalars().all()}
    exercise_names = await _session_exercise_names(db, session_ids)

    result = await compute_day_conformity(
        day, activities, lifting_sessions, exercise_names, date.today()
    )
    return {
        "plan_id": plan.id,
        "day_id": day.id,
        "day_date": day.day_date,
        "sport": day.sport,
        "planned_type": day.planned_type,
        **result,
    }

