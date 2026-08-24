"""Deficiency/weakness analysis service.

Analyses lifting and cycling data to detect training weaknesses:

A. Bodyweight strength standards (Big 3 vs multipliers of bodyweight)
B. Inter-exercise ratios (bench:squat, deadlift:squat, bench:deadlift)
C. Push/pull training-volume balance over the analysis window
D. VO2max vs FTP mismatch (aerobic profile coherence)
E. Aerobic decoupling trend
F. Power zone distribution (last 30 days)

Pure math lives in module-level functions (testable without a DB);
DB access lives in ``analyze_deficiencies()`` which follows the standard
service signature ``(db: AsyncSession, user_id: UUID, ...)``.
"""

import uuid
from datetime import UTC, date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cycling import CyclingProfile
from app.models.lifting import LiftingSession, LiftingSet, PersonalRecord
from app.schemas.deficiency import DeficiencyResponse, DeficiencySummary, WeaknessItem
from app.services.cycling.vo2max import (
    _classify_vo2max,
    compute_decoupling_history,
    estimate_vo2max,
)
from app.services.cycling.zones import compute_power_zones_from_streams
from app.services.exercise_db import normalise_exercise_name

# ── Constants ────────────────────────────────────────────────────────────────

# Bodyweight multipliers per lift: (beginner, intermediate, advanced, elite)
STANDARDS: dict[str, dict[str, float]] = {
    "Back Squat": {"beginner": 1.0, "intermediate": 1.5, "advanced": 2.0, "elite": 2.5},
    "Bench Press": {
        "beginner": 0.6,
        "intermediate": 1.0,
        "advanced": 1.4,
        "elite": 1.8,
    },
    "Deadlift": {"beginner": 1.2, "intermediate": 1.75, "advanced": 2.4, "elite": 3.0},
}

LEVEL_ORDER = ["beginner", "intermediate", "advanced", "elite"]

STANDARD_METRIC_KEYS = {
    "Back Squat": "back_squat_standard",
    "Bench Press": "bench_press_standard",
    "Deadlift": "deadlift_standard",
}

SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "strength": 4}

# Keyword matching for push/pull volume classification (lowercase substrings)
_PUSH_KEYWORDS = (
    "bench",
    "press",
    "push up",
    "pushup",
    "dip",
    "fly",
    "pec",
    "tricep",
    "skull",
    "ohp",
    "overhead",
    "shoulder",
)

_PULL_KEYWORDS = (
    "row",
    "pull up",
    "pullup",
    "chin",
    "pulldown",
    "face pull",
    "rear delt",
    "curl",
    "bicep",
    "shrug",
    "straight arm",
)

# VO2max classification label → ordinal rank (higher = better)
_VO2MAX_CLASS_RANK = {
    "Poor": 0,
    "Below Average": 1,
    "Average": 2,
    "Good": 3,
    "Excellent": 4,
    "Superior": 5,
}

_FTP_CLASS_RANK = {"poor": 0, "average": 1, "good": 2, "excellent": 3}


# ── Pure functions: strength standards ───────────────────────────────────────


def level_for_ratio(lift: str, ratio_to_bw: float) -> str:
    """Highest standard level whose threshold is met, else 'beginner'."""
    thresholds = STANDARDS[lift]
    for level in reversed(LEVEL_ORDER):
        if ratio_to_bw >= thresholds[level]:
            return level
    return "beginner"


def next_level_target(lift: str, level: str) -> float | None:
    """Absolute-bodyweight multiplier threshold of the next level up."""
    idx = LEVEL_ORDER.index(level)
    if idx >= len(LEVEL_ORDER) - 1:
        return None
    return STANDARDS[lift][LEVEL_ORDER[idx + 1]]


def severity_for_level(level: str) -> str:
    """Weakness severity for a standards level ('strength' handled separately)."""
    if level == "beginner":
        return "high"
    if level == "intermediate":
        return "medium"
    return "low"


# ── Pure functions: inter-exercise ratios ────────────────────────────────────


def evaluate_big3_ratios(
    squat: float, bench: float, deadlift: float
) -> list[tuple[str, float, str]]:
    """Evaluate Big-3 inter-exercise ratios.

    Returns a list of (metric, ratio_value, severity) tuples for every
    out-of-range ratio. Empty list means all ratios are balanced.
    """
    issues: list[tuple[str, float, str]] = []

    bench_squat = bench / squat
    if bench_squat < 0.55:
        issues.append(("bench_squat_ratio", round(bench_squat, 3), "critical"))
    elif bench_squat < 0.65:
        issues.append(("bench_squat_ratio", round(bench_squat, 3), "medium"))
    elif bench_squat > 0.85:
        issues.append(("bench_squat_ratio", round(bench_squat, 3), "high"))

    deadlift_squat = deadlift / squat
    if deadlift_squat < 1.0 or deadlift_squat > 1.35:
        issues.append(("deadlift_squat_ratio", round(deadlift_squat, 3), "medium"))

    bench_deadlift = bench / deadlift
    if bench_deadlift < 0.45 or bench_deadlift > 0.75:
        issues.append(("bench_deadlift_ratio", round(bench_deadlift, 3), "medium"))

    return issues


# ── Pure functions: push/pull volume balance ─────────────────────────────────


def classify_push_pull(exercise_name: str) -> str | None:
    """Classify an exercise as 'push', 'pull', or None (unclassified).

    Uses lowercase substring keyword matching. Ambiguous names matching
    both lists are excluded to stay conservative.
    """
    name = exercise_name.lower()
    push_hit = any(k in name for k in _PUSH_KEYWORDS)
    pull_hit = any(k in name for k in _PULL_KEYWORDS)
    if push_hit and not pull_hit:
        return "push"
    if pull_hit and not push_hit:
        return "pull"
    return None


def evaluate_push_pull_ratio(push_volume: float, pull_volume: float) -> dict | None:
    """Classify push/pull volume balance. Ideal ratio is 1.0–1.3.

    Returns a dict with value/severity/detail/recommendation for
    out-of-range balances, or None when in range.
    """
    if push_volume <= 0 or pull_volume <= 0:
        return None

    ratio = push_volume / pull_volume
    ratio_r = round(ratio, 2)
    base = {
        "value": ratio_r,
    }

    if ratio < 0.7:
        return {
            **base,
            "severity": "high",
            "detail": (
                f"Push/pull volume ratio is {ratio_r:.2f} "
                f"({push_volume:.0f}kg pushed vs {pull_volume:.0f}kg pulled) — "
                f"pulling deficit, increased shoulder injury risk"
            ),
            "recommendation": (
                "Add pulling volume: rows, pull-ups and face pulls — "
                "target roughly equal push and pull tonnage"
            ),
        }
    if ratio < 1.0:
        return {
            **base,
            "severity": "medium",
            "detail": (
                f"Push/pull volume ratio is {ratio_r:.2f} "
                f"({push_volume:.0f}kg pushed vs {pull_volume:.0f}kg pulled), "
                f"slightly below the ideal 1.0–1.3 range"
            ),
            "recommendation": "Add one extra pulling movement per upper-body session",
        }
    if ratio <= 1.3:
        return None  # in ideal range

    if ratio <= 1.6:
        return {
            **base,
            "severity": "low",
            "detail": (
                f"Push/pull volume ratio is {ratio_r:.2f} "
                f"({push_volume:.0f}kg pushed vs {pull_volume:.0f}kg pulled) — "
                f"push dominant (ideal 1.0–1.3)"
            ),
            "recommendation": "Balance with additional rowing and pull-up volume",
        }

    return {
        **base,
        "severity": "medium",
        "detail": (
            f"Push/pull volume ratio is {ratio_r:.2f} "
            f"({push_volume:.0f}kg pushed vs {pull_volume:.0f}kg pulled) — "
            f"strongly push dominant, elevated shoulder injury risk"
        ),
        "recommendation": (
            "Cut back pushing accessories and prioritise pulls — "
            "aim for at least 1kg pulled per kg pushed"
        ),
    }


# ── Pure functions: FTP classification ───────────────────────────────────────


def classify_ftp_wkg(watts_per_kg: float) -> tuple[str, int]:
    """Classify FTP by W/kg. Returns (label, rank)."""
    if watts_per_kg < 2.5:
        return "poor", _FTP_CLASS_RANK["poor"]
    if watts_per_kg < 3.2:
        return "average", _FTP_CLASS_RANK["average"]
    if watts_per_kg < 4.0:
        return "good", _FTP_CLASS_RANK["good"]
    return "excellent", _FTP_CLASS_RANK["excellent"]


def classify_ftp_absolute(ftp_watts: float) -> tuple[str, int]:
    """Fallback FTP classification without bodyweight. Returns (label, rank)."""
    if ftp_watts < 200:
        return "average", _FTP_CLASS_RANK["average"]
    if ftp_watts < 250:
        return "good", _FTP_CLASS_RANK["good"]
    return "excellent", _FTP_CLASS_RANK["excellent"]


# ── Item factory ─────────────────────────────────────────────────────────────


def _item(**kwargs) -> WeaknessItem:
    return WeaknessItem(**kwargs)


# ── Main entry point ─────────────────────────────────────────────────────────


async def analyze_deficiencies(
    db: AsyncSession,
    user_id: uuid.UUID,
    weeks: int = 8,
) -> DeficiencyResponse:
    """Run all weakness analyses and build the response.

    Args:
        db: Async database session.
        user_id: Owner of the data.
        weeks: Look-back window in weeks for volume balance (4–26).
    """
    items: list[WeaknessItem] = []

    # ── Fetch shared inputs ──────────────────────────────────────────────
    # Best 1RM per canonical Big-3 lift
    result = await db.execute(
        select(PersonalRecord.exercise_name, PersonalRecord.estimated_1rm).where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.record_type == "1rm",
        )
    )
    pr_rows = result.all()
    best_prs: dict[str, float] = {}
    for exercise_name, est_1rm in pr_rows:
        if est_1rm is None:
            continue
        canonical = normalise_exercise_name(exercise_name)
        if canonical in STANDARDS:
            current = best_prs.get(canonical)
            if current is None or est_1rm > current:
                best_prs[canonical] = float(est_1rm)

    # Cycling profile (FTP + bodyweight)
    result = await db.execute(
        select(CyclingProfile.ftp_watts, CyclingProfile.weight_kg).where(
            CyclingProfile.user_id == user_id
        )
    )
    profile_row = result.first()
    ftp_watts = (
        float(profile_row.ftp_watts) if profile_row and profile_row.ftp_watts else None
    )
    bodyweight = (
        float(profile_row.weight_kg) if profile_row and profile_row.weight_kg else None
    )

    # ── A. Bodyweight strength standards ─────────────────────────────────
    lift_levels: dict[str, str] = {}
    if bodyweight and bodyweight > 0:
        standards_items: list[WeaknessItem] = []
        for lift in STANDARDS:
            est_1rm = best_prs.get(lift)
            if est_1rm is None:
                continue
            ratio_to_bw = est_1rm / bodyweight
            level = level_for_ratio(lift, ratio_to_bw)
            lift_levels[lift] = level

            if level in ("advanced", "elite"):
                continue  # strong enough — no individual item

            target_mult = next_level_target(lift, level)
            target_kg = round(bodyweight * target_mult, 1) if target_mult else None
            adv_mult = STANDARDS[lift]["advanced"]
            standards_items.append(
                _item(
                    category="lifting",
                    type="strength_standard",
                    metric=STANDARD_METRIC_KEYS[lift],
                    value=round(est_1rm, 1),
                    unit="kg",
                    bodyweight=round(bodyweight, 1),
                    level=level,  # type: ignore[arg-type]
                    next_level_target=target_kg,
                    severity=severity_for_level(level),  # type: ignore[arg-type]
                    detail=(
                        f"{lift} 1RM is {est_1rm:.0f}kg = {ratio_to_bw:.2f}× BW "
                        f"({level}); advanced starts at {adv_mult:.1f}× BW "
                        f"({bodyweight * adv_mult:.0f}kg)"
                    ),
                    recommendation=(
                        f"Add {lift.split()[-1].lower()} volume — "
                        f"next milestone {target_kg:.0f}kg at {bodyweight:.0f}kg BW"
                    )
                    if target_kg
                    else f"Add {lift.lower()} volume to progress toward advanced standards",
                )
            )

        # All three advanced+ → single aggregate strength item
        if set(best_prs.keys()) == set(STANDARDS.keys()) and all(
            lift_levels.get(lift) in ("advanced", "elite") for lift in STANDARDS
        ):
            total_1rm = sum(best_prs.values())
            items.append(
                _item(
                    category="lifting",
                    type="strength_standard",
                    metric="big3_standards",
                    value=round(total_1rm, 1),
                    unit="kg",
                    bodyweight=round(bodyweight, 1),
                    level=None,
                    next_level_target=None,
                    severity="strength",
                    detail=(
                        f"All Big-3 lifts meet advanced standards: squat "
                        f"{best_prs['Back Squat']:.0f}kg, bench "
                        f"{best_prs['Bench Press']:.0f}kg, deadlift "
                        f"{best_prs['Deadlift']:.0f}kg "
                        f"(total {total_1rm:.0f}kg = {total_1rm / bodyweight:.1f}× BW)"
                    ),
                    recommendation=(
                        "Maintain strength with 1–2 heavy sessions weekly and "
                        "shift focus to cycling performance"
                    ),
                )
            )

        items.extend(standards_items)

    # ── B. Inter-exercise ratios ─────────────────────────────────────────
    squat_1rm = best_prs.get("Back Squat")
    bench_1rm = best_prs.get("Bench Press")
    deadlift_1rm = best_prs.get("Deadlift")

    if squat_1rm and bench_1rm and deadlift_1rm:
        ratio_issues = evaluate_big3_ratios(squat_1rm, bench_1rm, deadlift_1rm)
        ratio_context = {
            "bench_squat_ratio": {
                "label": "Bench:squat ratio",
                "ideal": "0.65–0.75",
                "below": "Bench Press lags behind Back Squat — add pressing volume",
                "above": "Bench dominant — balance with more squat frequency",
            },
            "deadlift_squat_ratio": {
                "label": "Deadlift:squat ratio",
                "ideal": "1.0–1.2",
                "below": "Weak deadlift relative to squat — add hinge volume",
                "above": "Squat weak relative to deadlift — add squat frequency",
            },
            "bench_deadlift_ratio": {
                "label": "Bench:deadlift ratio",
                "ideal": "0.55–0.65",
                "below": "Bench lags relative to deadlift — add pressing volume",
                "above": "Deadlift lags relative to bench — add hinge volume",
            },
        }

        for metric, value, severity in ratio_issues:
            ctx = ratio_context[metric]
            recommendation = ctx["below"] if value < 1 else ctx["above"]
            items.append(
                _item(
                    category="lifting",
                    type="ratio",
                    metric=metric,
                    value=value,
                    unit="ratio",
                    bodyweight=None,
                    level=None,
                    next_level_target=None,
                    severity=severity,  # type: ignore[arg-type]
                    detail=f"{ctx['label']} is {value:.2f} (ideal {ctx['ideal']})",
                    recommendation=recommendation,
                )
            )

        # Aggregate ratio-strength item: balanced ratios AND levels not all weak.
        # Skipped when bodyweight is unknown (levels unverifiable) or any lift
        # sits at beginner — emitting a "strength" there would be noise.
        if not ratio_issues and bodyweight:
            levels_known = [lift_levels.get(l) for l in STANDARDS]
            if all(levels_known) and not any(lvl == "beginner" for lvl in levels_known):
                total_1rm = squat_1rm + bench_1rm + deadlift_1rm
                items.append(
                    _item(
                        category="lifting",
                        type="ratio",
                        metric="big3_balance",
                        value=None,
                        unit=None,
                        bodyweight=round(bodyweight, 1),
                        level=None,
                        next_level_target=None,
                        severity="strength",
                        detail=(
                            f"Big-3 proportions are well balanced: bench:squat "
                            f"{bench_1rm / squat_1rm:.2f}, deadlift:squat "
                            f"{deadlift_1rm / squat_1rm:.2f}, bench:deadlift "
                            f"{bench_1rm / deadlift_1rm:.2f} "
                            f"(total {total_1rm:.0f}kg)"
                        ),
                        recommendation=(
                            "Keep current programming — proportional development "
                            "reduces injury risk"
                        ),
                    )
                )

    # ── C. Push/pull volume balance ──────────────────────────────────────
    cutoff = date.today() - timedelta(weeks=weeks)
    result = await db.execute(
        select(LiftingSet.exercise_name, LiftingSet.weight_kg, LiftingSet.reps)
        .join(LiftingSession, LiftingSet.session_id == LiftingSession.id)
        .where(
            LiftingSession.user_id == user_id,
            LiftingSession.session_date >= cutoff,
            LiftingSet.is_warmup.is_(False),
        )
    )
    volume_rows = result.all()

    push_volume = 0.0
    pull_volume = 0.0
    for exercise_name, weight_kg, reps in volume_rows:
        kind = classify_push_pull(exercise_name)
        if kind == "push":
            push_volume += weight_kg * reps
        elif kind == "pull":
            pull_volume += weight_kg * reps

    push_pull_result = evaluate_push_pull_ratio(push_volume, pull_volume)
    push_pull_in_range = (
        push_volume > 0 and pull_volume > 0 and push_pull_result is None
    )

    # ── D. VO2max vs FTP mismatch ────────────────────────────────────────
    if ftp_watts:
        vo2_estimate = await estimate_vo2max(db, user_id)
        if vo2_estimate is not None:
            vo2_label = _classify_vo2max(vo2_estimate.vo2max)
            vo2_rank = _VO2MAX_CLASS_RANK.get(vo2_label, 2)

            if bodyweight and bodyweight > 0:
                ftp_label, ftp_rank = classify_ftp_wkg(ftp_watts / bodyweight)
                ftp_desc = f"{ftp_watts:.0f}W = {ftp_watts / bodyweight:.2f}W/kg"
            else:
                ftp_label, ftp_rank = classify_ftp_absolute(ftp_watts)
                ftp_desc = f"{ftp_watts:.0f}W"

            if vo2_rank >= 3 and ftp_rank <= 2:
                items.append(
                    _item(
                        category="cycling",
                        type="vo2max_ftp_mismatch",
                        metric="vo2max_ftp_mismatch",
                        value=round(vo2_estimate.vo2max, 1),
                        unit=None,
                        bodyweight=round(bodyweight, 1) if bodyweight else None,
                        level=None,
                        next_level_target=None,
                        severity="medium",
                        detail=(
                            f"VO2max is {vo2_label} ({vo2_estimate.vo2max:.1f} "
                            f"ml/kg/min) but FTP is {ftp_label} ({ftp_desc}) — "
                            f"threshold power is the limiter"
                        ),
                        recommendation="Add sweet spot and threshold intervals",
                    )
                )
            elif ftp_rank >= 2 and vo2_rank <= 2:
                items.append(
                    _item(
                        category="cycling",
                        type="vo2max_ftp_mismatch",
                        metric="vo2max_ftp_mismatch",
                        value=round(vo2_estimate.vo2max, 1),
                        unit=None,
                        bodyweight=round(bodyweight, 1) if bodyweight else None,
                        level=None,
                        next_level_target=None,
                        severity="medium",
                        detail=(
                            f"FTP is {ftp_label} ({ftp_desc}) but VO2max is "
                            f"{vo2_label} ({vo2_estimate.vo2max:.1f} ml/kg/min) — "
                            f"aerobic ceiling limits further FTP gains"
                        ),
                        recommendation="Add Z2 base volume and VO2max intervals",
                    )
                )
            elif ftp_rank <= 2 and vo2_rank <= 2:
                items.append(
                    _item(
                        category="cycling",
                        type="vo2max_ftp_mismatch",
                        metric="vo2max_ftp_mismatch",
                        value=round(vo2_estimate.vo2max, 1),
                        unit=None,
                        bodyweight=round(bodyweight, 1) if bodyweight else None,
                        level=None,
                        next_level_target=None,
                        severity="high",
                        detail=(
                            f"Both aerobic markers are below average: FTP is "
                            f"{ftp_label} ({ftp_desc}) and VO2max is {vo2_label} "
                            f"({vo2_estimate.vo2max:.1f} ml/kg/min)"
                        ),
                        recommendation=("Build aerobic base first — mostly Z2 riding"),
                    )
                )
            elif ftp_rank >= 2 and vo2_rank >= 3:
                items.append(
                    _item(
                        category="cycling",
                        type="vo2max_ftp_mismatch",
                        metric="aerobic_profile",
                        value=round(vo2_estimate.vo2max, 1),
                        unit=None,
                        bodyweight=round(bodyweight, 1) if bodyweight else None,
                        level=None,
                        next_level_target=None,
                        severity="strength",
                        detail=(
                            f"Well-matched aerobic profile: FTP {ftp_label} "
                            f"({ftp_desc}), VO2max {vo2_label} "
                            f"({vo2_estimate.vo2max:.1f} ml/kg/min)"
                        ),
                        recommendation=(
                            "Maintain with one intensity session and plenty of "
                            "Z2 volume weekly"
                        ),
                    )
                )

    # ── E. Decoupling ────────────────────────────────────────────────────
    decoupling_history = await compute_decoupling_history(db, user_id, days=weeks * 7)
    if len(decoupling_history) >= 3:
        decoupling_avg = sum(d["decoupling_pct"] for d in decoupling_history) / len(
            decoupling_history
        )
        avg_r = round(decoupling_avg, 1)
        n = len(decoupling_history)
        if decoupling_avg > 8:
            items.append(
                _item(
                    category="cycling",
                    type="decoupling",
                    metric="decoupling_trend",
                    value=avg_r,
                    unit="%",
                    bodyweight=None,
                    level=None,
                    next_level_target=None,
                    severity="medium",
                    detail=(
                        f"Avg aerobic decoupling {avg_r}% across {n} long rides (>8%)"
                    ),
                    recommendation="Increase Zone 2 endurance volume",
                )
            )
        elif decoupling_avg >= 5:
            items.append(
                _item(
                    category="cycling",
                    type="decoupling",
                    metric="decoupling_trend",
                    value=avg_r,
                    unit="%",
                    bodyweight=None,
                    level=None,
                    next_level_target=None,
                    severity="low",
                    detail=(
                        f"Avg aerobic decoupling {avg_r}% across {n} long rides "
                        f"(acceptable is <5%)"
                    ),
                    recommendation="Extend long rides in Zone 2 to improve fatiguing stability",
                )
            )
        else:
            # Excellent (<5%) — fold into the aerobic strength item if present
            for existing in items:
                if (
                    existing.metric == "aerobic_profile"
                    and existing.severity == "strength"
                ):
                    existing.detail += (
                        f" Avg decoupling {avg_r}% across {n} long rides shows "
                        f"excellent aerobic durability."
                    )
                    break

    # ── F. Power zone distribution (last 30 days) ────────────────────────
    if ftp_watts:
        zones = await compute_power_zones_from_streams(db, user_id, ftp_watts, days=30)
        zone_pct = {z["zone"]: z["percentage"] for z in zones}
        easy_pct = round(zone_pct.get("Z1", 0) + zone_pct.get("Z2", 0), 1)
        tempo_pct = round(zone_pct.get("Z3", 0), 1)
        intense_pct = round(
            sum(zone_pct.get(z, 0) for z in ("Z4", "Z5", "Z6", "Z7")), 1
        )

        if easy_pct > 80:
            items.append(
                _item(
                    category="cycling",
                    type="zone_distribution",
                    metric="power_zone_distribution",
                    value=easy_pct,
                    unit="%",
                    bodyweight=None,
                    level=None,
                    next_level_target=None,
                    severity="low",
                    detail=(
                        f"{easy_pct}% of riding time in Z1-Z2 over last 30 days "
                        f"— missing intensity (Z3: {tempo_pct}%, Z4+: {intense_pct}%)"
                    ),
                    recommendation="Add one threshold/VO2max session weekly",
                )
            )
        elif intense_pct > 40:
            items.append(
                _item(
                    category="cycling",
                    type="zone_distribution",
                    metric="power_zone_distribution",
                    value=intense_pct,
                    unit="%",
                    bodyweight=None,
                    level=None,
                    next_level_target=None,
                    severity="medium",
                    detail=(
                        f"{intense_pct}% of riding time in Z4+ over last 30 days "
                        f"(Z1-Z2 only {easy_pct}%) — too much intensity, "
                        f"polarisation lost"
                    ),
                    recommendation="More Z2 easy volume",
                )
            )
        elif tempo_pct < 5:
            items.append(
                _item(
                    category="cycling",
                    type="zone_distribution",
                    metric="power_zone_distribution",
                    value=tempo_pct,
                    unit="%",
                    bodyweight=None,
                    level=None,
                    next_level_target=None,
                    severity="low",
                    detail=(
                        f"Only {tempo_pct}% of riding time in Z3 (tempo) over "
                        f"last 30 days — no sweet spot work (Z1-Z2: {easy_pct}%, "
                        f"Z4+: {intense_pct}%)"
                    ),
                    recommendation="Add sweet spot intervals (88–94% FTP) weekly",
                )
            )

    # ── C (contd). Push/pull strength fallback ───────────────────────────
    non_strength_count = sum(1 for i in items if i.severity != "strength")
    if push_pull_in_range and non_strength_count == 0:
        ratio_r = round(push_volume / pull_volume, 2)
        items.append(
            _item(
                category="lifting",
                type="volume_balance",
                metric="push_pull_ratio",
                value=ratio_r,
                unit="ratio",
                bodyweight=None,
                level=None,
                next_level_target=None,
                severity="strength",
                detail=(
                    f"Push/pull volume well balanced at {ratio_r:.2f} "
                    f"({push_volume:.0f}kg pushed vs {pull_volume:.0f}kg pulled "
                    f"over last {weeks} weeks)"
                ),
                recommendation="Keep balancing push and pull tonnage in programming",
            )
        )

    # ── Summary + ordering ───────────────────────────────────────────────
    items.sort(key=lambda w: SEVERITY_RANK[w.severity])
    non_strength = [i for i in items if i.severity != "strength"]

    summary = DeficiencySummary(
        total_weaknesses=len(non_strength),
        critical=sum(1 for i in non_strength if i.severity == "critical"),
        high=sum(1 for i in non_strength if i.severity == "high"),
        medium=sum(1 for i in non_strength if i.severity == "medium"),
        low=sum(1 for i in non_strength if i.severity == "low"),
        strengths=len(items) - len(non_strength),
    )

    return DeficiencyResponse(
        weaknesses=items,
        summary=summary,
        computed_at=datetime.now(UTC),
    )
