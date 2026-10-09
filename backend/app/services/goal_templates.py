"""Male-only goal templates (P2).

Curated, personalised goal starters for strength athletes: plate milestones
on the Big-3 lifts, bodyweight-ratio standards, and Big-3 total clubs. The
endpoint is read-only — each template carries a ``create_payload`` that
POSTs straight to ``POST /goals``.

Male-only by design: plate math assumes a men's 20 kg Olympic bar, and the
ratio levels come from ``services/deficiency.py`` STANDARDS (Symmetric
Strength / StrengthLevel tradition, calibrated on male lifters). The app
ships no sex field and no female UI — see frontend ``standards.ts``.
Do not add female coefficient tables here; the science validator (t4)
treats any female-standards leakage as a defect.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ── Catalog ────────────────────────────────────────────────────────────────
#
# Plate milestones are loaded-bar totals on a men's 20 kg bar (plates per
# side in the rationale). They are the classic gym milestones, not
# programming targets.

#: Lift → loaded-bar milestones (kg) in ascending order.
PLATE_MILESTONES: dict[str, list[float]] = {
    "Back Squat": [100.0, 120.0, 140.0, 160.0, 180.0, 200.0, 220.0],
    "Bench Press": [60.0, 80.0, 100.0, 120.0, 140.0, 160.0],
    "Deadlift": [140.0, 160.0, 180.0, 200.0, 220.0, 240.0, 260.0],
}

#: Big-3 total clubs (kg) — the classic raw milestones.
BIG3_CLUBS: list[float] = [400.0, 500.0, 600.0]

#: Metric key per lift for the BW-ratio goals.
BW_RATIO_METRICS: dict[str, str] = {
    "Back Squat": "squat_bw_ratio",
    "Bench Press": "bench_bw_ratio",
    "Deadlift": "deadlift_bw_ratio",
}

MENS_BAR_KG = 20.0


# ── Pure helpers (unit-testable) ───────────────────────────────────────────


def next_milestone_above(milestones: list[float], current: float) -> float | None:
    """First milestone strictly above *current*, or None when maxed out."""
    for milestone in milestones:
        if milestone > current:
            return milestone
    return None


def plates_per_side(total_kg: float, bar_kg: float = MENS_BAR_KG) -> float | None:
    """20 kg plates per side for a loaded bar, or None for non-round loads."""
    per_side = (total_kg - bar_kg) / 2
    if per_side <= 0:
        return None
    plates = per_side / 20.0
    if abs(plates - round(plates)) > 1e-9:
        return None
    return float(round(plates))


def plate_rationale(total_kg: float) -> str:
    """Short human rationale, e.g. '2 plates per side'."""
    plates = plates_per_side(total_kg)
    if plates is None:
        return f"{total_kg:g} kg loaded bar"
    n = int(plates)
    return f"{n} plate{'s' if n != 1 else ''} per side"


# ── Personalised templates (DB-backed, read-only) ──────────────────────────


async def get_goal_templates(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Build the personalised template list for *user_id*.

    Resolves bodyweight (latest weigh-in, profile fallback — same source as
    the BW-ratio resolvers), best Big-3 estimated 1RMs, and the Big-3 total,
    then suggests the next plate milestone / standards level / total club
    above each current value. Lifts with no data get entry-level starters.
    Returns ``{"bodyweight_kg": ..., "templates": [...]}``.
    """
    from app.models.cycling import CyclingProfile
    from app.models.lifting import PersonalRecord
    from app.services.deficiency import LEVEL_ORDER, STANDARDS, next_level_target
    from app.services.exercise_db import BIG_3_ORDER
    from app.services.lifting import latest_body_weight

    # Bodyweight: weigh-in first, static profile fallback (mirrors the
    # BW-ratio metric resolvers so suggestions agree with goal values).
    bodyweight = await latest_body_weight(db, user_id)
    if not bodyweight or bodyweight <= 0:
        result = await db.execute(
            select(CyclingProfile.weight_kg).where(CyclingProfile.user_id == user_id)
        )
        bodyweight = result.scalar_one_or_none()
    if bodyweight and bodyweight > 0:
        bodyweight = float(bodyweight)
    else:
        bodyweight = None

    # Best estimated 1RM per Big-3 lift.
    result = await db.execute(
        select(PersonalRecord.exercise_name, PersonalRecord.estimated_1rm).where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.exercise_name.in_(BIG_3_ORDER),
            PersonalRecord.record_type == "1rm",
            PersonalRecord.estimated_1rm.isnot(None),
        )
    )
    best: dict[str, float] = {}
    for name, one_rm in result.all():
        if one_rm is not None and (name not in best or one_rm > best[name]):
            best[name] = float(one_rm)

    total = round(sum(best.values()), 1) if best else None

    templates: list[dict] = []

    for lift in BIG_3_ORDER:
        current = best.get(lift)
        milestones = PLATE_MILESTONES[lift]

        # Plate milestone: next loaded bar above the current 1RM.
        if current is not None:
            target = next_milestone_above(milestones, current)
        else:
            target = milestones[0]
        if target is not None and (current is None or target > current):
            templates.append(
                {
                    "key": f"plate_{lift.lower().replace(' ', '_')}",
                    "kind": "plate_milestone",
                    "title": f"{lift}: {target:g} kg ({plate_rationale(target)})",
                    "description": (
                        f"Next plate milestone above your current {current:g} kg"
                        if current is not None
                        else "Entry-level plate milestone"
                    ),
                    "metric": "estimated_1rm",
                    "filter_json": {"exercise": lift},
                    "current_value": current,
                    "suggested_target": target,
                    "unit": "kg",
                    "create_payload": {
                        "metric": "estimated_1rm",
                        "filter_json": {"exercise": lift},
                        "target_value": target,
                    },
                }
            )

        # BW-ratio standard: next STANDARDS level above the current ratio.
        if bodyweight and current:
            ratio = current / bodyweight
            thresholds = STANDARDS[lift]
            current_level = "beginner"
            for level in reversed(LEVEL_ORDER):
                if ratio >= thresholds[level]:
                    current_level = level
                    break
            next_threshold = next_level_target(lift, current_level)
            if next_threshold is not None:
                metric = BW_RATIO_METRICS[lift]
                templates.append(
                    {
                        "key": f"standard_{lift.lower().replace(' ', '_')}",
                        "kind": "bw_ratio",
                        "title": (
                            f"{lift}: {current_level} → "
                            f"{LEVEL_ORDER[LEVEL_ORDER.index(current_level) + 1]} "
                            f"({next_threshold:g}×BW)"
                        ),
                        "description": (
                            f"Male strength-standard progression from your "
                            f"current {ratio:.2f}×BW"
                        ),
                        "metric": metric,
                        "filter_json": None,
                        "current_value": round(ratio, 3),
                        "suggested_target": next_threshold,
                        "unit": "ratio",
                        "create_payload": {
                            "metric": metric,
                            "filter_json": None,
                            "target_value": next_threshold,
                        },
                    }
                )

    # Big-3 total club above the current sum.
    if total is not None:
        club = next_milestone_above(BIG3_CLUBS, total)
    else:
        club = BIG3_CLUBS[0]
    if club is not None and (total is None or club > total):
        templates.append(
            {
                "key": "big3_total_club",
                "kind": "big3_total",
                "title": f"Big-3 total: {club:g} kg club",
                "description": (
                    f"Next total club above your current {total:g} kg"
                    if total is not None
                    else "Entry-level Big-3 total"
                ),
                "metric": "big3_total",
                "filter_json": None,
                "current_value": total,
                "suggested_target": club,
                "unit": "kg",
                "create_payload": {
                    "metric": "big3_total",
                    "filter_json": None,
                    "target_value": club,
                },
            }
        )

    return {"bodyweight_kg": bodyweight, "templates": templates}
