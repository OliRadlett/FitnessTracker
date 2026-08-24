"""Semantic goal metric registry — Phase 6.

Each metric key maps to a resolver that computes the current value for a
user, plus UI metadata (label/unit/required filters).  Goals reference a
metric key instead of the old hard-coded ``goal_type`` enum, so new metrics
only need a registry entry.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ── Types ────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class MetricDef:
    """Registry entry for a semantic goal metric."""

    key: str
    label: str
    unit: str
    requires_filter: list[str] | None  # filter keys that MUST be present
    optional_filter: list[str] | None  # filter keys that MAY be present
    default_direction: str  # "increase" | "decrease" — UI hint only
    resolver: Callable[[AsyncSession, uuid.UUID, dict | None], Awaitable[float | None]]


Resolver = Callable[[AsyncSession, uuid.UUID, dict | None], Awaitable[float | None]]

# ── Shared query helpers ─────────────────────────────────────────────────────


async def _resolve_ftp_watts(
    db: AsyncSession, user_id: uuid.UUID, _filters: dict | None
) -> float | None:
    from app.models.cycling import CyclingProfile

    result = await db.execute(
        select(CyclingProfile.ftp_watts).where(CyclingProfile.user_id == user_id)
    )
    ftp = result.scalar_one_or_none()
    return float(ftp) if ftp else None


async def _resolve_body_weight(
    db: AsyncSession, user_id: uuid.UUID, _filters: dict | None
) -> float | None:
    from app.models.weight import WeightLog

    result = await db.execute(
        select(WeightLog.weight_kilogram)
        .where(WeightLog.user_id == user_id)
        .order_by(WeightLog.date.desc())
        .limit(1)
    )
    weight = result.scalar_one_or_none()
    return float(weight) if weight else None


def _make_estimated_1rm_resolver(exercise_key: str | None = None) -> Resolver:
    """Resolver factory: estimated_1rm for a filter exercise (or fixed name)."""

    async def _resolve(
        db: AsyncSession, user_id: uuid.UUID, filters: dict | None
    ) -> float | None:
        from app.models.lifting import PersonalRecord
        from app.services.exercise_db import normalise_exercise_name

        raw = exercise_key or (filters or {}).get("exercise")
        if not raw:
            return None
        canonical = normalise_exercise_name(str(raw))
        result = await db.execute(
            select(PersonalRecord.estimated_1rm)
            .where(
                PersonalRecord.user_id == user_id,
                PersonalRecord.exercise_name == canonical,
                PersonalRecord.record_type == "1rm",
                PersonalRecord.estimated_1rm.isnot(None),
            )
            .order_by(PersonalRecord.estimated_1rm.desc())
            .limit(1)
        )
        best = result.scalar_one_or_none()
        return float(best) if best else None

    return _resolve


def _sport_condition(sport: str | None):
    """Return an SQLAlchemy condition for the optional sport filter, or None."""
    from app.models.activity import Activity

    if sport == "cycling":
        return Activity.sport_type == "cycling"
    if sport in ("strength", "powerlifting", "gym"):
        from app.services.strava.linking import STRENGTH_SPORT_TYPES

        return Activity.sport_type.in_(STRENGTH_SPORT_TYPES)
    return None


def _make_activity_sum_resolver(value_column, days: int | None, month_to_date: bool):
    """Factory: sum of an Activity column over rolling N days or month-to-date."""

    async def _resolve(
        db: AsyncSession, user_id: uuid.UUID, filters: dict | None
    ) -> float | None:
        from app.models.activity import Activity

        today = date.today()
        conditions = [
            Activity.user_id == user_id,
            Activity.source != "wahoo",  # dedup — Wahoo rides also come via Strava
        ]
        if month_to_date:
            conditions.append(Activity.start_date >= today.replace(day=1))
        elif days is not None:
            conditions.append(Activity.start_date >= today - timedelta(days=days))

        sport = (filters or {}).get("sport")
        cond = _sport_condition(sport if sport and sport != "all" else None)
        if cond is not None:
            conditions.append(cond)

        result = await db.execute(
            select(getattr(Activity, value_column)).where(*conditions)
        )
        values = list(result.scalars().all())
        return round(sum((v or 0) for v in values), 2)

    return _resolve


_resolve_monthly_distance_km = _make_activity_sum_resolver(
    "distance_meters", days=None, month_to_date=True
)


async def _monthly_distance_km_resolved(
    db: AsyncSession, user_id: uuid.UUID, filters: dict | None
) -> float | None:
    """Month-to-date distance in km (raw sum is metres)."""
    total_m = await _resolve_monthly_distance_km(db, user_id, filters)
    return round(total_m / 1000.0, 2) if total_m is not None else None


async def _resolve_weekly_sessions(
    db: AsyncSession, user_id: uuid.UUID, filters: dict | None
) -> float | None:
    """Rolling-7-day session count (lifting + cardio), mirroring legacy logic."""
    from app.models.activity import Activity
    from app.models.lifting import LiftingSession

    today = date.today()
    week_ago = today - timedelta(days=7)
    sport = (filters or {}).get("sport")

    count = 0.0

    if sport in (None, "", "all", "strength", "powerlifting"):
        result = await db.execute(
            select(LiftingSession.id).where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= week_ago,
            )
        )
        count += len(list(result.scalars().all()))

    if sport not in ("strength", "powerlifting"):
        # Legacy behaviour: every non-Wahoo activity counts (Wahoo rides are
        # deduped because they also arrive via Strava).
        conditions = [
            Activity.user_id == user_id,
            Activity.start_date >= week_ago,
            Activity.source != "wahoo",
        ]
        if sport == "cycling":
            conditions.append(Activity.sport_type == "cycling")
        elif sport:
            cond = _sport_condition(sport)
            if cond is not None:
                conditions.append(cond)
        result = await db.execute(select(Activity.id).where(*conditions))
        count += len(list(result.scalars().all()))

    return count


async def _resolve_weekly_tss(
    db: AsyncSession, user_id: uuid.UUID, filters: dict | None
) -> float | None:
    """Rolling-7-day TSS sum from activities."""
    from app.models.activity import Activity

    today = date.today()
    conditions = [
        Activity.user_id == user_id,
        Activity.start_date >= today - timedelta(days=7),
        Activity.tss.isnot(None),
        Activity.source != "wahoo",
    ]
    sport = (filters or {}).get("sport")
    cond = _sport_condition(sport if sport and sport != "all" else None)
    if cond is not None:
        conditions.append(cond)

    result = await db.execute(select(Activity.tss).where(*conditions))
    values = list(result.scalars().all())
    return round(sum(values), 1) if values else 0.0


async def _resolve_vo2max(
    db: AsyncSession, user_id: uuid.UUID, _filters: dict | None
) -> float | None:
    from app.services.cycling.vo2max import estimate_vo2max

    estimate = await estimate_vo2max(db, user_id)
    return estimate.vo2max if estimate else None


def _make_bw_ratio_resolver(canonical_exercise: str) -> Resolver:
    """estimated_1rm ÷ body weight (CyclingProfile.weight_kg)."""

    async def _resolve(
        db: AsyncSession, user_id: uuid.UUID, _filters: dict | None
    ) -> float | None:
        from app.models.cycling import CyclingProfile
        from app.models.lifting import PersonalRecord

        result = await db.execute(
            select(CyclingProfile.weight_kg).where(CyclingProfile.user_id == user_id)
        )
        weight = result.scalar_one_or_none()
        if not weight or weight <= 0:
            return None

        result = await db.execute(
            select(PersonalRecord.estimated_1rm)
            .where(
                PersonalRecord.user_id == user_id,
                PersonalRecord.exercise_name == canonical_exercise,
                PersonalRecord.record_type == "1rm",
                PersonalRecord.estimated_1rm.isnot(None),
            )
            .order_by(PersonalRecord.estimated_1rm.desc())
            .limit(1)
        )
        best = result.scalar_one_or_none()
        if not best or best <= 0:
            return None
        return round(float(best) / float(weight), 3)

    return _resolve


async def _resolve_big3_total(
    db: AsyncSession, user_id: uuid.UUID, _filters: dict | None
) -> float | None:
    """Sum of Big-3 estimated 1RMs (present lifts only); None if none exist."""
    from app.models.lifting import PersonalRecord
    from app.services.exercise_db import BIG_3_ORDER

    result = await db.execute(
        select(PersonalRecord.exercise_name, PersonalRecord.estimated_1rm).where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.exercise_name.in_(BIG_3_ORDER),
            PersonalRecord.record_type == "1rm",
            PersonalRecord.estimated_1rm.isnot(None),
        )
    )
    rows = result.all()

    # Best per lift
    best: dict[str, float] = {}
    for name, one_rm in rows:
        if one_rm is not None and (name not in best or one_rm > best[name]):
            best[name] = float(one_rm)

    if not best:
        return None
    return round(sum(best.values()), 1)


def _make_daily_metric_resolver(column_name: str) -> Resolver:
    async def _resolve(
        db: AsyncSession, user_id: uuid.UUID, _filters: dict | None
    ) -> float | None:
        from app.models.daily_metric import DailyMetric

        col = getattr(DailyMetric, column_name)
        result = await db.execute(
            select(col)
            .where(
                DailyMetric.user_id == user_id,
                col.isnot(None),
            )
            .order_by(DailyMetric.metric_date.desc())
            .limit(1)
        )
        value = result.scalar_one_or_none()
        return float(value) if value else None

    return _resolve


# ── Registry ─────────────────────────────────────────────────────────────────

METRIC_REGISTRY: dict[str, MetricDef] = {
    m.key: m
    for m in [
        MetricDef(
            key="ftp_watts",
            label="FTP",
            unit="W",
            requires_filter=None,
            optional_filter=None,
            default_direction="increase",
            resolver=_resolve_ftp_watts,
        ),
        MetricDef(
            key="body_weight",
            label="Body Weight",
            unit="kg",
            requires_filter=None,
            optional_filter=None,
            default_direction="decrease",
            resolver=_resolve_body_weight,
        ),
        MetricDef(
            key="estimated_1rm",
            label="Estimated 1RM",
            unit="kg",
            requires_filter=["exercise"],
            optional_filter=None,
            default_direction="increase",
            resolver=_make_estimated_1rm_resolver(),
        ),
        MetricDef(
            key="weekly_sessions",
            label="Weekly Sessions",
            unit="count",
            requires_filter=None,
            optional_filter=["sport"],
            default_direction="increase",
            resolver=_resolve_weekly_sessions,
        ),
        MetricDef(
            key="monthly_distance_km",
            label="Monthly Distance",
            unit="km",
            requires_filter=None,
            optional_filter=["sport"],
            default_direction="increase",
            resolver=_monthly_distance_km_resolved,
        ),
        MetricDef(
            key="weekly_tss",
            label="Weekly TSS",
            unit="TSS",
            requires_filter=None,
            optional_filter=["sport"],
            default_direction="increase",
            resolver=_resolve_weekly_tss,
        ),
        MetricDef(
            key="vo2max",
            label="VO2max",
            unit="ml/kg/min",
            requires_filter=None,
            optional_filter=None,
            default_direction="increase",
            resolver=_resolve_vo2max,
        ),
        MetricDef(
            key="squat_bw_ratio",
            label="Squat ×Bodyweight Ratio",
            unit="ratio",
            requires_filter=None,
            optional_filter=None,
            default_direction="increase",
            resolver=_make_bw_ratio_resolver("Back Squat"),
        ),
        MetricDef(
            key="bench_bw_ratio",
            label="Bench ×Bodyweight Ratio",
            unit="ratio",
            requires_filter=None,
            optional_filter=None,
            default_direction="increase",
            resolver=_make_bw_ratio_resolver("Bench Press"),
        ),
        MetricDef(
            key="deadlift_bw_ratio",
            label="Deadlift ×Bodyweight Ratio",
            unit="ratio",
            requires_filter=None,
            optional_filter=None,
            default_direction="increase",
            resolver=_make_bw_ratio_resolver("Deadlift"),
        ),
        MetricDef(
            key="big3_total",
            label="Big 3 Total",
            unit="kg",
            requires_filter=None,
            optional_filter=None,
            default_direction="increase",
            resolver=_resolve_big3_total,
        ),
        MetricDef(
            key="resting_hr",
            label="Resting Heart Rate",
            unit="bpm",
            requires_filter=None,
            optional_filter=None,
            default_direction="decrease",
            resolver=_make_daily_metric_resolver("resting_hr"),
        ),
        MetricDef(
            key="hrv_ms",
            label="HRV",
            unit="ms",
            requires_filter=None,
            optional_filter=None,
            default_direction="increase",
            resolver=_make_daily_metric_resolver("hrv_ms"),
        ),
    ]
}


# ── Public API ───────────────────────────────────────────────────────────────


async def resolve_metric(
    db: AsyncSession, user_id: uuid.UUID, metric: str, filter_json: dict | None
) -> float | None:
    """Resolve the current value for *metric* (None when data is missing)."""
    definition = METRIC_REGISTRY.get(metric)
    if definition is None:
        raise ValueError(f"Unknown metric: {metric!r}")
    return await definition.resolver(db, user_id, filter_json)


def list_metrics() -> list[dict]:
    """Registry listing for GET /goals/metrics (drives dynamic forms)."""
    return [
        {
            "key": m.key,
            "label": m.label,
            "unit": m.unit,
            "requires_filter": m.requires_filter,
            "optional_filter": m.optional_filter,
            "default_direction": m.default_direction,
        }
        for m in METRIC_REGISTRY.values()
    ]


def validate_metric_filters(metric: str, filter_json: dict | None) -> str | None:
    """Return an error message when required filters are missing, else None."""
    definition = METRIC_REGISTRY.get(metric)
    if definition is None:
        return (
            f"Unknown metric {metric!r}. Must be one of: {', '.join(METRIC_REGISTRY)}"
        )
    required = definition.requires_filter or []
    provided = filter_json or {}
    missing = [key for key in required if not str(provided.get(key, "")).strip()]
    if missing:
        return f"Metric {metric!r} requires filter key(s): {', '.join(missing)}"
    return None
