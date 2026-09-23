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

import logging
import uuid
from datetime import UTC, date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.daily_metric import DailyMetric
from app.models.health_alert import HealthAlert
from app.models.lifting import LiftingSession
from app.models.training_plan import TrainingPlan, TrainingPlanDay

logger = logging.getLogger(__name__)

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

# ── F4: VBT autoregulation ───────────────────────────────────────────────
# Intra-set velocity loss above which the bar is slowing meaningfully.
VELOCITY_LOSS_HIGH = 25.0
# ...and above which the set was clearly a grinder.
VELOCITY_LOSS_SEVERE = 40.0
# How recent a video must be for its velocity loss to vote on advice.
VELOCITY_LOSS_WINDOW_DAYS = 14

# ── CD1: cross-sport fatigue interference ────────────────────────────────
# Lifting "stress" below is an approximation: session volume_kg + session RPE
# stand in for neuromuscular leg fatigue (there is no validated kg→TSS
# mapping). Thresholds are deliberately conservative so only clearly heavy
# days trigger a cross-sport vote.
# Yesterday's lower-body volume at/above this marks the legs as loaded.
LEGS_YESTERDAY_VOLUME_KG = 4000.0
# A legs-focused session at/above this RPE marks the legs as loaded even
# when recorded volume is low (e.g. heavy singles).
LEGS_HIGH_RPE = 8.0
# Yesterday's cycling TSS at/above this marks cycling as loaded.
CYCLING_YESTERDAY_TSS = 150.0
# Trailing-window average cycling TSS/day at/above this also marks cycling
# as loaded (accumulated load, not just a single big ride).
CYCLING_7D_AVG_TSS_PER_DAY = 100.0
# Trailing window (days, ending yesterday inclusive) for accumulated load.
CROSS_SPORT_WINDOW_DAYS = 7

# LiftingSession.focus values treated as lower-body / leg-loading work.
LOWER_BODY_FOCUS = frozenset(
    {
        "squat",
        "deadlift",
        "legs",
        "lower",
        "lower_body",
        "full_body",
        "full-body",
    }
)

# ── CD2: recovery → strength autoregulation ──────────────────────────────
# DailyMetric/HRV-gated scaling for strength volume. The thresholds are
# deliberately simple and documented (not a black-box readiness score):
# down-scale only on clearly poor recovery, up-scale only when recovery is
# high AND recent lifting RPE ran easy AND no health alert is active.
# Down-scale applied to strength-day volume when triggered.
STRENGTH_READINESS_DOWN_FACTOR = 0.9
# Conservative upside, gated on all three conditions below.
STRENGTH_READINESS_UP_FACTOR = 1.05
# Recovery at/above this (with easy RPE + no alerts) unlocks the upside.
STRENGTH_READINESS_HIGH_RECOVERY = 80.0
# Latest HRV below (1 − drop) × trailing baseline counts as "sharply down".
HRV_BASELINE_DAYS = 7
HRV_SHARP_DROP_PCT = 25.0
# Minimum prior HRV points to trust the baseline (avoids single-point noise).
HRV_BASELINE_MIN_POINTS = 3
# Trailing window + ceiling for "recent RPE ran easy".
STRENGTH_RPE_WINDOW_DAYS = 7
STRENGTH_RPE_EASY_MAX = 6.0

_SEVERITY_ORDER = {"info": 0, "warning": 1, "critical": 2}


def _worst_alert_severity(severities: list[str | None]) -> str | None:
    """Worst severity by rank.

    Plain ``max()`` on severity strings is alphabetical (``critical`` <
    ``info`` < ``warning``) and would report ``warning`` when a ``critical``
    alert is present.
    """
    ranked = [s for s in severities if s in _SEVERITY_ORDER]
    if not ranked:
        return None
    return max(ranked, key=lambda s: _SEVERITY_ORDER[s])


# ── CD1: cross-sport fatigue helper ───────────────────────────────────────


def _is_lower_body_focus(focus: str | None) -> bool:
    """True when a lifting focus string denotes leg-loading work."""
    if not focus:
        return False
    normalized = focus.strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in LOWER_BODY_FOCUS:
        return True
    return any(token in normalized for token in ("squat", "deadlift", "leg", "lower"))


async def cross_sport_fatigue(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Prior-day / trailing-week load across the lifting↔cycling boundary.

    Computes (a) yesterday's lower-body lifting volume + session RPE +
    whether any yesterday session had a squat/deadlift-legs focus, (b)
    trailing-window lower-body lifting volume, (c) yesterday's cycling
    TSS, (d) trailing-window cycling TSS.

    Lifting "stress" is an approximation (volume_kg + session RPE, not a
    validated muscle-damage model) — callers label it as such in reasons.

    Returns ``{"legs_loaded", "legs_detail", "cycling_loaded",
    "cycling_detail"}`` plus the raw numbers behind each flag.
    """
    today = date.today()
    yesterday = today - timedelta(days=1)
    window_start = yesterday - timedelta(days=CROSS_SPORT_WINDOW_DAYS - 1)

    # ── Lifting: yesterday's sessions ────────────────────────────────────
    lift_result = await db.execute(
        select(LiftingSession).where(
            LiftingSession.user_id == user_id,
            LiftingSession.session_date == yesterday,
        )
    )
    lift_rows = lift_result.scalars().all()
    yesterday_leg_volume = sum(
        (s.total_volume_kg or 0.0) for s in lift_rows if _is_lower_body_focus(s.focus)
    )
    yesterday_leg_rpe = max(
        [s.rpe_session for s in lift_rows if s.rpe_session is not None],
        default=None,
    )
    legs_focused = any(_is_lower_body_focus(s.focus) for s in lift_rows)

    # ── Lifting: trailing-window lower-body volume ───────────────────────
    week_result = await db.execute(
        select(LiftingSession).where(
            LiftingSession.user_id == user_id,
            LiftingSession.session_date >= window_start,
            LiftingSession.session_date <= yesterday,
        )
    )
    week_rows = week_result.scalars().all()
    trailing_leg_volume = sum(
        (s.total_volume_kg or 0.0) for s in week_rows if _is_lower_body_focus(s.focus)
    )

    legs_loaded = (yesterday_leg_volume >= LEGS_YESTERDAY_VOLUME_KG) or (
        legs_focused
        and yesterday_leg_rpe is not None
        and yesterday_leg_rpe >= LEGS_HIGH_RPE
    )
    legs_detail = (
        f"yesterday lower-body volume {yesterday_leg_volume:.0f} kg"
        + (
            f", session RPE {yesterday_leg_rpe:.1f}"
            if yesterday_leg_rpe is not None
            else ""
        )
        + f" (7d lower-body {trailing_leg_volume:.0f} kg)"
        if lift_rows
        else "no lifting sessions logged yesterday"
    )

    # ── Cycling: TSS sums (UTC day windows on start_date) ────────────────
    y_start = datetime(yesterday.year, yesterday.month, yesterday.day, tzinfo=UTC)
    t_start = y_start + timedelta(days=1)
    w_start = y_start - timedelta(days=CROSS_SPORT_WINDOW_DAYS - 1)

    yesterday_tss = (
        await db.execute(
            select(func.coalesce(func.sum(Activity.tss), 0.0)).where(
                Activity.user_id == user_id,
                Activity.sport_type == "cycling",
                Activity.start_date >= y_start,
                Activity.start_date < t_start,
                Activity.tss.isnot(None),
            )
        )
    ).scalar_one() or 0.0
    trailing_tss = (
        await db.execute(
            select(func.coalesce(func.sum(Activity.tss), 0.0)).where(
                Activity.user_id == user_id,
                Activity.sport_type == "cycling",
                Activity.start_date >= w_start,
                Activity.start_date < t_start,
                Activity.tss.isnot(None),
            )
        )
    ).scalar_one() or 0.0
    trailing_avg = float(trailing_tss) / CROSS_SPORT_WINDOW_DAYS

    cycling_loaded = (float(yesterday_tss) >= CYCLING_YESTERDAY_TSS) or (
        trailing_avg >= CYCLING_7D_AVG_TSS_PER_DAY
    )
    cycling_detail = (
        f"yesterday cycling TSS {float(yesterday_tss):.0f} "
        f"(7d avg {trailing_avg:.0f}/day)"
    )

    return {
        "legs_loaded": bool(legs_loaded),
        "legs_detail": legs_detail,
        "cycling_loaded": bool(cycling_loaded),
        "cycling_detail": cycling_detail,
        "yesterday_leg_volume_kg": round(float(yesterday_leg_volume), 1),
        "trailing_7d_leg_volume_kg": round(float(trailing_leg_volume), 1),
        "yesterday_cycling_tss": round(float(yesterday_tss), 1),
        "trailing_7d_cycling_tss": round(float(trailing_tss), 1),
        "trailing_7d_avg_tss_per_day": round(float(trailing_avg), 1),
    }


# ── CD2: recovery → strength readiness ─────────────────────────────────


async def strength_readiness(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Recovery/HRV-gated readiness factor for strength volume (CD2).

    Returns ``{"factor": float, "note": str}``. ``factor`` is 1.0 by default;
    0.9 when the latest recovery is below ``RECOVERY_LOW`` or the latest HRV
    sits more than ``HRV_SHARP_DROP_PCT`` below its trailing baseline;
    1.05 only when recovery is at/above ``STRENGTH_READINESS_HIGH_RECOVERY``
    AND the trailing-window average session RPE ran easy AND no health alert
    is active (conservative upside). Missing inputs degrade to neutral —
    never to a down-scale.
    """
    today = date.today()

    rec_row = (
        await db.execute(
            select(DailyMetric.recovery_score)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.recovery_score.isnot(None),
            )
            .order_by(DailyMetric.metric_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    recovery = float(rec_row) if rec_row is not None else None

    if recovery is not None and recovery < RECOVERY_LOW:
        return {
            "factor": STRENGTH_READINESS_DOWN_FACTOR,
            "note": (
                f"Readiness check: latest recovery {recovery:.0f}/100 is below "
                f"{RECOVERY_LOW:.0f} — strength volume scaled "
                f"×{STRENGTH_READINESS_DOWN_FACTOR:g}."
            ),
        }

    hrv_rows = (
        (
            await db.execute(
                select(DailyMetric.hrv_ms)
                .where(
                    DailyMetric.user_id == user_id,
                    DailyMetric.hrv_ms.isnot(None),
                )
                .order_by(DailyMetric.metric_date.desc())
                .limit(HRV_BASELINE_DAYS + 1)
            )
        )
        .scalars()
        .all()
    )
    if hrv_rows:
        latest_hrv = float(hrv_rows[0])
        baseline_pts = [float(v) for v in hrv_rows[1:]]
        if len(baseline_pts) >= HRV_BASELINE_MIN_POINTS:
            baseline = sum(baseline_pts) / len(baseline_pts)
            if baseline > 0 and latest_hrv < baseline * (1 - HRV_SHARP_DROP_PCT / 100):
                drop_pct = (baseline - latest_hrv) / baseline * 100
                return {
                    "factor": STRENGTH_READINESS_DOWN_FACTOR,
                    "note": (
                        f"Readiness check: latest HRV {latest_hrv:.0f} ms is "
                        f"{drop_pct:.0f}% below its {HRV_BASELINE_DAYS}-day "
                        f"baseline ({baseline:.0f} ms) — strength volume "
                        f"scaled ×{STRENGTH_READINESS_DOWN_FACTOR:g}."
                    ),
                }

    if recovery is not None and recovery >= STRENGTH_READINESS_HIGH_RECOVERY:
        rpe_avg = (
            await db.execute(
                select(func.avg(LiftingSession.rpe_session)).where(
                    LiftingSession.user_id == user_id,
                    LiftingSession.session_date
                    >= today - timedelta(days=STRENGTH_RPE_WINDOW_DAYS),
                    LiftingSession.rpe_session.isnot(None),
                )
            )
        ).scalar_one()
        if rpe_avg is not None and float(rpe_avg) <= STRENGTH_RPE_EASY_MAX:
            active_alerts = (
                await db.execute(
                    select(func.count(HealthAlert.id)).where(
                        HealthAlert.user_id == user_id,
                        HealthAlert.status == "active",
                    )
                )
            ).scalar_one() or 0
            if not active_alerts:
                return {
                    "factor": STRENGTH_READINESS_UP_FACTOR,
                    "note": (
                        f"Readiness check: recovery {recovery:.0f}/100 with easy "
                        f"recent RPE ({float(rpe_avg):.1f}) and no active "
                        "alerts — strength volume scaled "
                        f"×{STRENGTH_READINESS_UP_FACTOR:g}."
                    ),
                }

    if recovery is None:
        note = "Readiness check: no recent recovery data — full strength targets."
    else:
        note = (
            f"Readiness check: recovery {recovery:.0f}/100 steady — "
            "full strength targets."
        )
    return {"factor": 1.0, "note": note}


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
    velocity_loss_pct: float | None = None,
    velocity_zone: str | None = None,
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

    # ── Recovery — the strongest single rest signal ────────────────────────
    # Recovery gating overrides the raw TSB load axis: when recovery is low the
    # headline advice is a rest day, so the recovery "rest" axis leads (axes[0])
    # and the intensity axis is suppressed to avoid two conflicting load stances.
    recovery_low = recovery is not None and recovery < RECOVERY_LOW
    if recovery_low:
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
                "actions": [],
            }
        )

    # ── Plan conformity ────────────────────────────────────────────────────
    # Low conformity ("plan too ambitious") leads with an "ease" headline axis;
    # full+stable conformity leads with a "build" headline axis. Both prepend so
    # the dominant signal is axes[0].
    conformity_low = conformity_pct is not None and conformity_pct < CONFORMITY_EASY_LOW
    full_conformity = (
        conformity_pct is not None
        and conformity_pct >= CONFORMITY_FULL_HIGH
        and conformity_trend != "declining"
    )
    if conformity_low:
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
    elif full_conformity:
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

    # ── Load trajectory (fitness vs fatigue) ───────────────────────────────
    # Runs after recovery/conformity so a headline rest/ease/build axis already
    # occupies axes[0]. The load axis is only added when it adds a distinct
    # signal: it is suppressed when recovery-low (which already drove "rest") so
    # the two don't fight, but kept otherwise to back the cut/maintain/raise
    # suggestions.
    if tsb is not None and not recovery_low:
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
                    "actions": [],
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
                    "actions": [],
                }
            )

    for pattern in patterns:
        suggestions.append(
            {
                "type": "pattern",
                "title": "Pattern noticed",
                "detail": pattern,
                "severity": "info",
                "actions": [],
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
                "actions": [],
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
                "actions": [],
            }
        )

    # ── Autoregulation (VBT, F4) ───────────────────────────────────────────
    # A sharp intra-set bar-speed drop (from the latest analysed lift video)
    # means the set was near failure — advise trimming load/reps rather than
    # pushing on. Advisory only; it never changes the plan-level load stance.
    if velocity_loss_pct is not None and velocity_loss_pct >= VELOCITY_LOSS_HIGH:
        severe = velocity_loss_pct >= VELOCITY_LOSS_SEVERE
        zone_note = f" (last zone: {velocity_zone})" if velocity_zone else ""
        axes.append(
            {
                "key": "autoregulation",
                "title": "Bar speed",
                "stance": "ease",
                "severity": "warning" if severe else "info",
                "guidance": (
                    f"Bar speed fell {velocity_loss_pct:.0f}% across your last set"
                    f"{zone_note}. "
                    + (
                        "That is a grinder — cut the load ~5–10% or stop the set "
                        "one rep earlier."
                        if severe
                        else "Consider trimming a rep or a small load reduction next time."
                    )
                ),
            }
        )
        suggestions.append(
            {
                "type": "autoregulation",
                "title": "Autoregulate the next set",
                "detail": (
                    f"Bar speed dropped {velocity_loss_pct:.0f}%"
                    + (
                        " — cut the load ~5–10% or end the set sooner."
                        if severe
                        else " — leave one rep in reserve."
                    )
                ),
                "severity": "warning" if severe else "info",
                "actions": [],
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


# ── QW6: goal-aware adaptive ────────────────────────────────────────────
# Only these training-performance metrics can steer load advice; health /
# body-composition goals never vote to raise training.
PERFORMANCE_GOAL_METRICS = frozenset(
    {"ftp_watts", "weekly_tss", "estimated_1rm", "weekly_sessions"}
)
# Projection badges that count as off-pace (see services/projections.py).
GOAL_OFF_PACE_BADGES = frozenset({"At Risk", "Unlikely"})
# The athlete must be absorbing the plan before a goal may add load.
GOAL_RAISE_CONFORMITY_FLOOR = 70.0


async def _off_pace_performance_goals(
    db: AsyncSession, user_id: uuid.UUID
) -> list[dict]:
    """Active performance goals with target dates projecting off-pace.

    Returns ``[{metric, target_value, target_date, projected_date, badge}]``
    for goals whose ``compute_goal_projection`` badge is At Risk/Unlikely.
    Goals already met (status != active) or ahead (On Track) are excluded —
    callers must NOT ease off for those (see the QW6 note above).
    Best-effort per goal: a failing projection skips that goal only.
    """
    from app.models.goal import Goal
    from app.services.projections import compute_goal_projection

    result = await db.execute(
        select(Goal).where(
            Goal.user_id == user_id,
            Goal.status == "active",
            Goal.target_date.isnot(None),
            Goal.metric.in_(PERFORMANCE_GOAL_METRICS),
        )
    )
    off_pace: list[dict] = []
    for goal in result.scalars().all():
        try:
            proj = await compute_goal_projection(db, user_id, goal.id)
        except Exception:
            logger.warning(
                "Goal projection failed for goal %s (%s)",
                goal.id,
                goal.metric,
                exc_info=True,
            )
            continue
        if proj.get("badge") not in GOAL_OFF_PACE_BADGES:
            continue
        projection = proj.get("projection") or {}
        off_pace.append(
            {
                "metric": goal.metric,
                "target_value": goal.target_value,
                "target_date": goal.target_date,
                "projected_date": projection.get("projected_date"),
                "badge": proj.get("badge"),
            }
        )
    return off_pace


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
            scaled_rpe = _scaled(day.planned_rpe, factor, 1, 10)
            # RPE is prescribed in whole numbers.
            fields["planned_rpe"] = (
                round(scaled_rpe) if scaled_rpe is not None else None
            )
    return fields


def _actions_for(
    plan_id: uuid.UUID,
    days: list[TrainingPlanDay],
    kind: str,
    factor: float,
    force_rest: bool = False,
    strength_volume_factor: float | None = None,
) -> list[dict]:
    """Build one-tap apply actions for the upcoming training days.

    ``strength_volume_factor`` (CD2): when set, strength-day
    ``planned_volume_kg`` scales by this combined factor instead of ``factor``
    (still clamped by the existing bounds); cycle days and RPE are untouched.
    """
    actions: list[dict] = []
    for day in days:
        if force_rest:
            fields: dict[str, object] = {"sport": "rest", "planned_type": "rest"}
            label = f"Rest on {day.day_date.isoformat()}"
        else:
            fields = _fields_for_scale(day, factor)
            if (
                strength_volume_factor is not None
                and day.sport == "strength"
                and day.planned_volume_kg is not None
            ):
                fields["planned_volume_kg"] = _scaled(
                    day.planned_volume_kg, strength_volume_factor, 100, 200000
                )
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
    # Personalized path: fitted ctl_tau/atl_tau when the Modal power-model
    # fit produced them, else the canonical 42/7 constants. Chart/dashboard
    # call sites intentionally stay on compute_training_load's canonical
    # constants so displayed CTL/ATL/TSB remain comparable across users;
    # only adaptive advice reacts to personalized taus.
    tsb = ctl = atl = None
    try:
        from app.services.cycling.training_load import training_load_for_user

        today = date.today()
        series = await training_load_for_user(db, user_id, today, lookback_days=90)
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
    alert_severity = _worst_alert_severity([a.severity for a in alerts])

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

    # ── Latest lift-video velocity loss (F4 autoregulation) ────────────────
    velocity_loss_pct = None
    velocity_zone = None
    try:
        from app.models.lifting import LiftVideo

        vrow = (
            await db.execute(
                select(LiftVideo)
                .where(
                    LiftVideo.user_id == user_id,
                    LiftVideo.velocity_loss_pct.isnot(None),
                    LiftVideo.created_at
                    >= datetime.now(UTC) - timedelta(days=VELOCITY_LOSS_WINDOW_DAYS),
                )
                .order_by(LiftVideo.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if vrow is not None:
            velocity_loss_pct = vrow.velocity_loss_pct
            velocity_zone = vrow.vbt_zone
    except Exception:
        velocity_loss_pct = velocity_zone = None

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
        velocity_loss_pct=velocity_loss_pct,
        velocity_zone=velocity_zone,
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
        # ── CD2: recovery → strength modulation ────────────────────────
        # Strength-day volume scales by factor × readiness (cycle days keep
        # the plain factor). Neutral readiness (1.0) leaves the actions
        # identical to before; the note is appended only when modulated and
        # only to suggestions that actually touch a strength day.
        try:
            _readiness = await strength_readiness(db, user_id)
        except Exception:
            logger.warning(
                "strength_readiness failed; using neutral factor", exc_info=True
            )
            _readiness = {"factor": 1.0, "note": ""}
        _readiness_factor = float(_readiness.get("factor") or 1.0)
        _strength_scale = (
            factor * _readiness_factor if _readiness_factor != 1.0 else None
        )
        _strength_day_ids = {str(d.id) for d in upcoming if d.sport == "strength"}
        # Attach to the scale-type suggestion(s) that drive the intensity stance.
        for s in outcome["suggestions"]:
            if (factor < 1 and s["type"] in ("intensity_cut",)) or (
                factor > 1 and s["type"] == "intensity_raise"
            ):
                s["actions"] = _actions_for(
                    plan.id,
                    upcoming,
                    kind,
                    factor,
                    strength_volume_factor=_strength_scale,
                )
                if (
                    _strength_scale is not None
                    and _readiness.get("note")
                    and any(a.get("day_id") in _strength_day_ids for a in s["actions"])
                ):
                    s["detail"] = f"{s['detail']} {_readiness['note']}".strip()
        # Rest advice attaches to the first upcoming training day.
        for s in outcome["suggestions"]:
            if s["type"] == "rest_day" and upcoming:
                s["actions"] = _actions_for(
                    plan.id, upcoming, "rest", 1.0, force_rest=True
                )

    # ── CD1: cross-sport fatigue interference ────────────────────────────
    # Legs loaded → ease the upcoming cycle day(s); hard cycling → scale
    # the upcoming strength day(s). Reuses the intensity_cut machinery (no
    # new action types); fields stay clamped via _fields_for_scale.
    # Lifting stress is an approximation (volume + RPE) — reasons say so.
    try:
        cross = await cross_sport_fatigue(db, user_id)
    except Exception:
        cross = None
    if cross and plan is not None and upcoming:
        if cross.get("legs_loaded"):
            cycle_days = [d for d in upcoming if d.sport == "cycle"][:DAY_ACTION_LIMIT]
            if cycle_days:
                outcome["suggestions"].append(
                    {
                        "type": "intensity_cut",
                        "title": "Ease cycling after leg day",
                        "detail": (
                            f"Yesterday's lifting loaded the legs "
                            f"({cross['legs_detail']}; lifting stress is an "
                            f"approximation from volume + RPE). Lower planned "
                            f"power/duration/TSS by "
                            f"~{round((1 - CUT_FACTOR) * 100)}% on the next "
                            f"cycle day(s)."
                        ),
                        "severity": "warning",
                        "actions": _actions_for(plan.id, cycle_days, "cut", CUT_FACTOR),
                    }
                )
        if cross.get("cycling_loaded"):
            strength_days = [d for d in upcoming if d.sport == "strength"][
                :DAY_ACTION_LIMIT
            ]
            if strength_days:
                outcome["suggestions"].append(
                    {
                        "type": "intensity_cut",
                        "title": "Ease lifting after hard riding",
                        "detail": (
                            f"Recent cycling load is high "
                            f"({cross['cycling_detail']}). Scale the next "
                            f"strength day volume down "
                            f"~{round((1 - CUT_FACTOR) * 100)}%."
                        ),
                        "severity": "warning",
                        "actions": _actions_for(
                            plan.id, strength_days, "cut", CUT_FACTOR
                        ),
                    }
                )

    # ── QW6: goal-aware adaptive ─────────────────────────────────────────
    # An off-pace performance goal (At Risk/Unlikely) votes to raise load
    # when the athlete is absorbing the plan (conformity ≥ 70) and no
    # health block exists. Reuses the intensity_raise machinery on the next
    # training days; the reason cites the goal + projected date.
    # Deliberately NO ease-off when a goal is met/ahead: cutting load
    # because a goal looks safe would punish good progress and invite
    # detraining (a perverse incentive) — the plan's own progression
    # already absorbs it.
    if (
        plan is not None
        and upcoming
        and conformity_pct is not None
        and conformity_pct >= GOAL_RAISE_CONFORMITY_FLOOR
        and not alerts
    ):
        try:
            off_pace = await _off_pace_performance_goals(db, user_id)
        except Exception:
            off_pace = []
        for g in off_pace:
            projected = g["projected_date"]
            if projected is not None and hasattr(projected, "isoformat"):
                trajectory = f"trend projects {projected.isoformat()}"
            else:
                trajectory = "trend is heading away from target"
            outcome["suggestions"].append(
                {
                    "type": "intensity_raise",
                    "title": f"Chase goal: {g['metric']}",
                    "detail": (
                        f"Goal {g['metric']} (target {g['target_value']:g} by "
                        f"{g['target_date'].isoformat()}) is {g['badge']} — "
                        f"{trajectory}. You are absorbing "
                        f"the plan ({conformity_pct:.0f}% conformity), so raise "
                        f"planned power/duration/TSS by "
                        f"~{round((RAISE_FACTOR - 1) * 100)}% on the next "
                        f"training days."
                    ),
                    "severity": "info",
                    "actions": _actions_for(plan.id, upcoming, "raise", RAISE_FACTOR),
                }
            )

    for s in outcome["suggestions"]:
        s.setdefault("actions", [])

    return outcome
