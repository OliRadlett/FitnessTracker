"""Adaptive weekly training suggestions (§3.11).

Combines the signals FitTrack already computes — plan conformity (5C),
training load (TSB trajectory), recovery state, health alerts and deficiency
priorities — into a per-week "shift" recommendation (volume / intensity /
rest) and optionally attach *one-tap apply* actions that the frontend can
execute via ``PATCH /training-plans/{plan_id}/days/{day_id}``.

The inference lives in :func:`derive_adaptive_advice` as a pure function
(unit-testable with injected inputs); :func:`generate_adaptive_suggestions`
glues it to the database and attaches concrete day-level ``actions``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.daily_metric import DailyMetric
from app.models.health_alert import HealthAlert
from app.models.training_plan import TrainingPlan, TrainingPlanDay

# Fatigue zones — TSB below this means the athlete is deep in the red.
TSB_FATIGUE_THRESHOLD = -20.0
# Freshness above which progressive overload is sensible.
TSB_OVERLOAD_THRESHOLD = 5.0
# Latest Whoop/Whoop-style recovery score below which rest is advised.
RECOVERY_LOW = 40.0
# Conformity (plan-vs-actual) bands for ambition evaluation.
CONFORMITY_EASY_LOW = 70.0
CONFORMITY_FULL_HIGH = 90.0
# Multiplier applied when backing off / adding load.
CUT_FACTOR = 0.85
RAISE_FACTOR = 1.08
# How many upcoming training days a scale-action touches.
DAY_ACTION_LIMIT = 3

_SEVERITY_ORDER = {"info": 0, "warning": 1, "critical": 2}


# ── Pure inference ────────────────────────────────────────────────────────


def _decide_intensity(
    tsb: float | None,
    recovery: float | None,
    conformity_pct: float | None,
    trend: str | None,
) -> tuple[str, float, list[str]]:
    """Net "cut / raise / maintain" decision with reasons.

    Every signal casts a vote; a single cut vote dominates a raise. Returns
    ``(stance, factor, reasons)``.
    """
    votes: list[tuple[str, str]] = []

    if tsb is not None:
        if tsb <= TSB_FATIGUE_THRESHOLD:
            votes.append(("cut", f"TSB {tsb:.0f} is deeply fatigued"))
        elif tsb >= TSB_OVERLOAD_THRESHOLD:
            votes.append(("raise", f"TSB {tsb:.0f} shows headroom for overload"))

    if recovery is not None and recovery < RECOVERY_LOW:
        votes.append(("cut", f"latest recovery is only {recovery:.0f}/100"))

    if conformity_pct is not None:
        if conformity_pct < CONFORMITY_EASY_LOW:
            votes.append(
                (
                    "cut",
                    f"plan conformity is {conformity_pct:.0f}% — targets exceed what you hit",
                )
            )
        elif conformity_pct >= CONFORMITY_FULL_HIGH and trend != "declining":
            votes.append(
                (
                    "raise",
                    f"plan conformity is {conformity_pct:.0f}% — targets are comfortably met",
                )
            )

    if not votes:
        return "maintain", 1.0, []

    if any(v[0] == "cut" for v in votes):
        return "cut", CUT_FACTOR, [v[1] for v in votes if v[0] == "cut"]

    raise_reasons = [v[1] for v in votes if v[0] == "raise"]
    return "raise", RAISE_FACTOR, raise_reasons


def derive_adaptive_advice(
    *,
    tsb: float | None = None,
    ctl: float | None = None,
    atl: float | None = None,
    recovery: float | None = None,
    conformity_pct: float | None = None,
    conformity_trend: str | None = None,
    conformity_classification: str | None = None,
    patterns: list[str] | None = None,
    active_alerts: int = 0,
    alert_severity: str | None = None,
    top_deficiency: str | None = None,
) -> dict:
    """Build the adaptive recommendation from computed signals.

    Pure — never touches the database. Returns the advice envelope without
    day-level actions (dropped in by the caller).
    """
    patterns = patterns or []

    if tsb is not None:
        fatigue = (
            "fatigued"
            if tsb <= TSB_FATIGUE_THRESHOLD
            else "fresher"
            if tsb >= TSB_OVERLOAD_THRESHOLD
            else "balanced"
        )
    else:
        fatigue = None

    axes: list[dict] = []
    suggestions: list[dict] = []

    # ── Load trajectory (fitness vs fatigue) ───────────────────────────────
    if tsb is not None:
        stance, _factor, reasons = _decide_intensity(
            tsb, recovery, conformity_pct, conformity_trend
        )
        if stance == "maintain":
            axes.append(
                {
                    "key": "load",
                    "title": "Fitness vs fatigue",
                    "stance": "maintain",
                    "severity": "info",
                    "guidance": (
                        f"TSB {tsb:.0f} is in the healthy band"
                        + (f" (CTL {ctl:.0f} · ATL {atl:.0f})" if ctl and atl else "")
                        + " — keep the current plan as written."
                    ),
                }
            )
        elif stance == "cut":
            axes.append(
                {
                    "key": "load",
                    "title": "Fitness vs fatigue",
                    "stance": "recover",
                    "severity": "critical"
                    if tsb <= TSB_FATIGUE_THRESHOLD
                    else "warning",
                    "guidance": f"TSB {tsb:.0f} and the recent training pattern suggest backing off this week.",
                }
            )
            suggestions.append(
                {
                    "type": "intensity_cut",
                    "title": "Ease the next sessions",
                    "detail": (
                        f"Lower planned power/duration/TSS by ~{round((1 - CUT_FACTOR) * 100)}% on "
                        f"the next training days. {reasons[0] if reasons else ''}"
                    ).strip(),
                    "severity": "critical"
                    if tsb <= TSB_FATIGUE_THRESHOLD
                    else "warning",
                }
            )
        else:
            axes.append(
                {
                    "key": "load",
                    "title": "Fitness vs fatigue",
                    "stance": "build",
                    "severity": "warning",
                    "guidance": (
                        f"TSB {tsb:.0f} leaves room to push — raise planned "
                        "intensity slightly this week."
                    ),
                }
            )
            suggestions.append(
                {
                    "type": "intensity_raise",
                    "title": "Lean into the freshness",
                    "detail": (
                        f"Raise planned power/duration/TSS by ~{round((RAISE_FACTOR - 1) * 100)}% "
                        f"on the next training days. {reasons[0] if reasons else ''}"
                    ).strip(),
                    "severity": "warning",
                }
            )

    # ── Recovery — the strongest single rest signal ────────────────────────
    if recovery is not None and recovery < RECOVERY_LOW:
        axes.append(
            {
                "key": "recovery",
                "title": "Recovery",
                "stance": "rest",
                "severity": "warning",
                "guidance": (
                    f"Latest recovery is {recovery:.0f}/100 — below the {RECOVERY_LOW:.0f} "
                    "threshold. Consider swapping the next training day for rest."
                ),
            }
        )
        suggestions.append(
            {
                "type": "rest_day",
                "title": "Swap in a rest day",
                "detail": "Turn the next non-rest session into a rest day so recovery can catch up.",
                "severity": "warning",
            }
        )

    # ── Plan conformity ────────────────────────────────────────────────────
    if conformity_pct is not None:
        if conformity_pct < CONFORMITY_EASY_LOW:
            axes.append(
                {
                    "key": "conformity",
                    "title": "Plan vs actual",
                    "stance": "ease",
                    "severity": "warning",
                    "guidance": (
                        f"Only {conformity_pct:.0f}% of planned sessions matched targets "
                        f"({conformity_classification or 'deviation'}). The plan is writing cheques "
                        "your current form can't cash — lower planned intensity to loop back in."
                    ),
                }
            )
        elif conformity_pct >= CONFORMITY_FULL_HIGH and conformity_trend != "declining":
            axes.append(
                {
                    "key": "conformity",
                    "title": "Plan vs actual",
                    "stance": "build",
                    "severity": "info",
                    "guidance": (
                        f"Plan conformity is {conformity_pct:.0f}% — the current load is "
                        "comfortably absorbed. Add a little progressive overload."
                    ),
                }
            )

    for pattern in patterns:
        suggestions.append(
            {
                "type": "pattern",
                "title": "Pattern noticed",
                "detail": pattern,
                "severity": "info",
            }
        )

    # ── Health alerts — gate load before anything else ─────────────────────
    if active_alerts > 0:
        sev = alert_severity or "warning"
        axes.append(
            {
                "key": "health",
                "title": "Health alerts",
                "stance": "rest",
                "severity": sev,
                "guidance": (
                    f"{active_alerts} active health alert(s) pending. Resolve or dismiss them "
                    "before adding load — training through risk signals compounds fatigue."
                ),
            }
        )
        suggestions.append(
            {
                "type": "health_check",
                "title": "Clear health alerts first",
                "detail": f"{active_alerts} active alert(s) — review the Health page before this week's plan.",
                "severity": sev,
            }
        )

    # ── Deficiency priorities (advisory) ───────────────────────────────────
    if top_deficiency:
        suggestions.append(
            {
                "type": "deficiency",
                "title": "Priority weakness",
                "detail": top_deficiency,
                "severity": "info",
            }
        )

    # ── Summary sentence ───────────────────────────────────────────────────
    if active_alerts > 0:
        summary = "Health signals are flagging — resolve those before adjusting load."
    elif any(s["type"] == "rest_day" for s in suggestions):
        summary = "Recovery is low — the headline advice is rest, not more work."
    elif any(s["type"] == "intensity_cut" for s in suggestions):
        summary = "Signals favour easing back this week."
    elif any(s["type"] == "intensity_raise" for s in suggestions):
        summary = "You have freshness to spend — add a little overload."
    else:
        summary = "Signals are balanced — stick to the plan."
    if not tsb and not recovery and conformity_pct is None and not patterns:
        summary = (
            "Not enough data yet — train on and check back after a few scored sessions."
        )
        if not axes and not suggestions:
            axes.append(
                {
                    "key": "data",
                    "title": "Insufficient data",
                    "stance": "maintain",
                    "severity": "info",
                    "guidance": "Connect a plan and log some sessions — adaptive advice needs history.",
                }
            )

    return {
        "fatigue": fatigue,
        "summary": summary,
        "axes": axes,
        "suggestions": suggestions,
    }


# ── DB glue + day-level actions ───────────────────────────────────────────


def _scaled(
    value: float | None, factor: float, lo: float | None, hi: float | None
) -> float | None:
    if value is None:
        return None
    out = value * factor
    if lo is not None:
        out = max(out, lo)
    if hi is not None:
        out = min(out, hi)
    return round(out, 1)


def _fields_for_scale(day: TrainingPlanDay, factor: float) -> dict[str, float | int]:
    """PATCH-able fields for one day scaled by ``factor``."""
    fields: dict[str, float | int] = {}
    if day.sport == "cycle":
        if day.planned_power_watts is not None:
            fields["planned_power_watts"] = _scaled(
                day.planned_power_watts, factor, 60, 600
            )
        if day.planned_duration_min is not None:
            fields["planned_duration_min"] = _scaled(
                day.planned_duration_min, factor, 30, 600
            )
        if day.planned_tss is not None:
            fields["planned_tss"] = _scaled(day.planned_tss, factor, 10, 400)
    elif day.sport == "strength":
        if day.planned_volume_kg is not None:
            fields["planned_volume_kg"] = _scaled(
                day.planned_volume_kg, factor, 100, 200000
            )
        if day.planned_rpe is not None:
            fields["planned_rpe"] = _scaled(day.planned_rpe, factor, 1, 10)
    return fields


def _actions_for(
    plan_id: uuid.UUID,
    days: list[TrainingPlanDay],
    kind: str,
    factor: float,
    force_rest: bool = False,
) -> list[dict]:
    """Build one-tap apply actions for the upcoming training days."""
    actions: list[dict] = []
    for day in days:
        if force_rest:
            fields: dict[str, object] = {"sport": "rest", "planned_type": "rest"}
            label = f"Rest on {day.day_date.isoformat()}"
        else:
            fields = _fields_for_scale(day, factor)
            if not fields:
                continue
            noun = "volume" if day.sport == "strength" else "load"
            dir_word = "lower" if kind == "cut" else "raise"
            label = f"{dir_word.title()} {noun} · {day.day_date.isoformat()}"
        actions.append(
            {
                "label": label,
                "plan_id": str(plan_id),
                "day_id": str(day.id),
                "fields": fields,
            }
        )
    return actions


async def _upcoming_training_days(
    db: AsyncSession, plan_id: uuid.UUID, limit: int = DAY_ACTION_LIMIT
) -> list[TrainingPlanDay]:
    result = await db.execute(
        select(TrainingPlanDay)
        .where(
            TrainingPlanDay.plan_id == plan_id,
            TrainingPlanDay.day_date >= date.today(),
            TrainingPlanDay.sport.in_(["cycle", "strength"]),
        )
        .order_by(TrainingPlanDay.day_date.asc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def generate_adaptive_suggestions(
    db: AsyncSession,
    user_id: uuid.UUID,
    plan_id: uuid.UUID | None = None,
) -> dict:
    """Full adaptive recommendation for the user's active plan.

    Raises ``ValueError`` when ``plan_id`` is given but missing/not owned.
    With no ``plan_id`` the most recently started active plan is chosen;
    users with no plan get load/recovery advice without day actions.
    """
    # Active plan resolution.
    if plan_id is not None:
        result = await db.execute(
            select(TrainingPlan).where(
                TrainingPlan.id == plan_id,
                TrainingPlan.user_id == user_id,
            )
        )
        plan = result.scalar_one_or_none()
        if plan is None:
            raise LookupError("Training plan not found")
    else:
        result = await db.execute(
            select(TrainingPlan)
            .where(
                TrainingPlan.user_id == user_id,
                TrainingPlan.status == "active",
            )
            .order_by(TrainingPlan.start_date.desc())
        )
        plan = result.scalars().first()

    # ── Training load (CTL/ATL/TSB) ────────────────────────────────────────
    tsb = ctl = atl = None
    try:
        from app.services.cycling.training_load import compute_training_load
        from app.services.cycling.tss import get_daily_tss

        today = date.today()
        daily = await get_daily_tss(db, user_id, today - timedelta(days=90), today)
        series = compute_training_load(daily, today, lookback_days=90)
        if series:
            last = series[-1]
            tsb, ctl, atl = last["tsb"], last["ctl"], last["atl"]
    except Exception:
        # Load math is best-effort — a failure here shouldn't kill advice.
        tsb = ctl = atl = None

    # ── Recovery (latest DailyMetric recovery_score) ───────────────────────
    recovery = None
    rec_result = await db.execute(
        select(DailyMetric.recovery_score)
        .where(
            DailyMetric.user_id == user_id,
            DailyMetric.recovery_score.isnot(None),
        )
        .order_by(DailyMetric.metric_date.desc())
        .limit(1)
    )
    row = rec_result.scalar_one_or_none()
    if row is not None:
        recovery = float(row)

    # ── Conformity + patterns ──────────────────────────────────────────────
    conformity_pct = conformity_trend = conformity_classification = None
    patterns: list[str] = []
    if plan is not None:
        try:
            from app.services.conformity import get_plan_conformity

            conf = await get_plan_conformity(db, user_id, plan.id)
            conformity_pct = conf.get("overall_pct")
            conformity_trend = conf.get("trend")
            conformity_classification = (
                "Excellent"
                if conformity_pct and conformity_pct >= 90
                else "Good"
                if conformity_pct and conformity_pct >= 70
                else None
            )
            patterns = list(conf.get("patterns") or [])
        except Exception:
            conformity_pct = conformity_trend = conformity_classification = None
            patterns = []

    # ── Health alerts ──────────────────────────────────────────────────────
    alert_result = await db.execute(
        select(HealthAlert).where(
            HealthAlert.user_id == user_id,
            HealthAlert.status == "active",
        )
    )
    alerts = list(alert_result.scalars().all())
    alert_severity = None
    if alerts:
        alert_severity = max(
            (a.severity for a in alerts if a.severity in _SEVERITY_ORDER),
            default=None,
        )

    # ── Top deficiency (advisory) ──────────────────────────────────────────
    top_deficiency = None
    try:
        from app.services.deficiency import analyze_deficiencies

        deff = await analyze_deficiencies(db, user_id)
        item = next(
            (w for w in deff.weaknesses if w.severity.value in ("critical", "high")),
            None,
        )
        if item is not None:
            top_deficiency = item.recommendation or item.detail
    except Exception:
        top_deficiency = None

    envelope = derive_adaptive_advice(
        tsb=tsb,
        ctl=ctl,
        atl=atl,
        recovery=recovery,
        conformity_pct=conformity_pct,
        conformity_trend=conformity_trend,
        conformity_classification=conformity_classification,
        patterns=patterns,
        active_alerts=len(alerts),
        alert_severity=alert_severity,
        top_deficiency=top_deficiency,
    )

    # ── Attach day-level actions ───────────────────────────────────────────
    upcoming: list[TrainingPlanDay] = []
    if plan is not None:
        upcoming = await _upcoming_training_days(db, plan.id)

    outcome: dict = {
        "generated_at": datetime.now(UTC).isoformat(),
        "plan_id": str(plan.id) if plan else None,
        "plan_name": plan.name if plan else None,
        **envelope,
    }

    factor = None
    for s in outcome["suggestions"]:
        if s["type"] == "intensity_cut":
            factor = CUT_FACTOR
        elif s["type"] == "intensity_raise":
            factor = RAISE_FACTOR

    if factor is not None and upcoming:
        kind = "cut" if factor < 1 else "raise"
        # Attach to the scale-type suggestion(s) that drive the intensity stance.
        for s in outcome["suggestions"]:
            if (factor < 1 and s["type"] in ("intensity_cut",)) or (
                factor > 1 and s["type"] == "intensity_raise"
            ):
                s["actions"] = _actions_for(plan.id, upcoming, kind, factor)
        # Rest advice attaches to the first upcoming training day.
        for s in outcome["suggestions"]:
            if s["type"] == "rest_day" and upcoming:
                s["actions"] = _actions_for(
                    plan.id, upcoming, "rest", 1.0, force_rest=True
                )

    for s in outcome["suggestions"]:
        s.setdefault("actions", [])

    return outcome
