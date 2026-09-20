"""Cycling service — CTL/ATL/TSB computation, cycling profile, and metric benchmarks."""

import math
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cycling import CyclingProfile
from app.models.weight import WeightLog

# ── Constants ────────────────────────────────────────────────────────────────

CTL_DAYS = 42  # Chronic Training Load time constant
ATL_DAYS = 7  # Acute Training Load time constant

# EWMA warm-up: the loop seeds CTL/ATL at 0, so it iterates this many extra
# leading days (real TSS where the caller fetched it, else 0) before the
# reported window. 5τ for CTL leaves <1% residual bias. Callers must fetch
# at least ``lookback_days + CTL_WARMUP_DAYS`` of daily TSS for the full
# benefit; output length is unchanged (warm-up days are not returned).
CTL_WARMUP_DAYS = 210


# ── CTL / ATL / TSB ─────────────────────────────────────────────────────────


def compute_training_load(
    daily_tss: dict[date, float],
    end_date: date,
    lookback_days: int = 90,
    ctl_days: float = CTL_DAYS,
    atl_days: float = ATL_DAYS,
) -> list[dict]:
    """Compute CTL, ATL, and TSB for each day over a lookback period.

    Uses exponentially weighted moving averages:
    CTL_t = CTL_{t-1} + (TSS_t - CTL_{t-1}) × (1 - e^(-1/ctl_days))
    ATL_t = ATL_{t-1} + (TSS_t - ATL_{t-1}) × (1 - e^(-1/atl_days))
    TSB_t = CTL_t - ATL_t

    ``ctl_days``/``atl_days`` default to the canonical 42/7 constants so
    existing callers are unaffected; pass fitted taus (see
    ``training_load_for_user``) for personalized time constants.

    The EWMAs seed at 0, so iteration starts ``CTL_WARMUP_DAYS`` before the
    reported window (consuming real TSS from ``daily_tss`` where present).
    Only the requested ``lookback_days + 1`` points are returned.

    Returns a list of dicts with keys: date, tss, ctl, atl, tsb.
    """
    start_date = end_date - timedelta(days=lookback_days)
    warmup_start = start_date - timedelta(days=CTL_WARMUP_DAYS)
    ctl_decay = 1 - math.exp(-1 / ctl_days)
    atl_decay = 1 - math.exp(-1 / atl_days)

    result = []
    ctl = 0.0
    atl = 0.0

    current = warmup_start
    while current <= end_date:
        raw_tss = daily_tss.get(current, 0.0)
        tss = (
            raw_tss
            if (isinstance(raw_tss, (int, float)) and math.isfinite(raw_tss))
            else 0.0
        )
        ctl = ctl + (tss - ctl) * ctl_decay
        atl = atl + (tss - atl) * atl_decay
        tsb = ctl - atl

        if current >= start_date:
            result.append(
                {
                    "date": current,
                    "tss": round(tss, 1),
                    "ctl": round(ctl, 1),
                    "atl": round(atl, 1),
                    "tsb": round(tsb, 1),
                }
            )
        current += timedelta(days=1)

    return result


async def training_load_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    end_date: date,
    lookback_days: int = 90,
) -> list[dict]:
    """Compute the CTL/ATL/TSB series for a user, honouring fitted taus.

    Loads the user's ``CyclingProfile`` and uses the fitted ``ctl_tau`` /
    ``atl_tau`` (Modal weekly power-model fit) when **both** are positive
    numbers; otherwise falls back to the canonical 42/7 constants. Daily
    TSS is loaded from the DB, so callers need no extra queries.
    """
    ctl_days: float = CTL_DAYS
    atl_days: float = ATL_DAYS
    result = await db.execute(
        select(CyclingProfile).where(CyclingProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if profile is not None:
        ctl_tau = profile.ctl_tau
        atl_tau = profile.atl_tau
        if (
            isinstance(ctl_tau, (int, float))
            and isinstance(atl_tau, (int, float))
            and ctl_tau > 0
            and atl_tau > 0
            and math.isfinite(float(ctl_tau))
            and math.isfinite(float(atl_tau))
        ):
            ctl_days = float(ctl_tau)
            atl_days = float(atl_tau)

    # Local import: tss.py must never import training_load (cycle).
    from app.services.cycling.tss import get_daily_tss

    daily = await get_daily_tss(
        db,
        user_id,
        end_date - timedelta(days=lookback_days + CTL_WARMUP_DAYS),
        end_date,
    )
    return compute_training_load(
        daily,
        end_date,
        lookback_days=lookback_days,
        ctl_days=ctl_days,
        atl_days=atl_days,
    )


# ── Typical Ranges ───────────────────────────────────────────────────────────

TYPICAL_RANGES: dict[str, dict[str, tuple[float, float]]] = {
    "ftp_w_per_kg": {
        "untrained": (0, 2.0),
        "recreational": (2.0, 3.0),
        "trained": (3.0, 4.0),
        "competitive": (4.0, 5.0),
        "elite": (5.0, 10.0),
    },
    "ctl": {
        "detraining": (0, 30),
        "maintaining": (30, 60),
        "building": (60, 100),
        "high": (100, 500),
    },
    "vi": {
        "excellent": (1.0, 1.05),
        "good": (1.05, 1.10),
        "moderate": (1.10, 1.20),
        "variable": (1.20, 2.0),
    },
}


# Friendly display labels for range names
RANGE_LABELS: dict[str, str] = {
    "untrained": "Untrained",
    "recreational": "Recreational",
    "trained": "Trained",
    "competitive": "Competitive",
    "elite": "Elite",
    "detraining": "Detraining",
    "maintaining": "Maintaining",
    "building": "Building",
    "high": "High Load",
    "excellent": "Excellent",
    "good": "Good",
    "moderate": "Moderate",
    "variable": "Variable",
}


def classify_metric(value: float, metric_name: str) -> str | None:
    """Classify a metric value into a range label."""
    ranges = TYPICAL_RANGES.get(metric_name)
    if not ranges:
        return None
    for label, (low, high) in ranges.items():
        if low <= value < high:
            return label
    return None


def get_metric_benchmark(value: float, metric_name: str) -> dict | None:
    """Get a benchmark classification for a metric value.

    Returns a dict with 'label' and 'range' keys, or None if not classifiable.
    """
    label = classify_metric(value, metric_name)
    if not label:
        return None
    ranges = TYPICAL_RANGES.get(metric_name, {})
    low, high = ranges.get(label, (0, 0))
    return {
        "label": RANGE_LABELS.get(label, label),
        "range": f"{low}–{high}" if high < 500 else f"{low}+",
        "raw_label": label,
    }


# ── Helpers ──────────────────────────────────────────────────────────────────


async def get_or_create_cycling_profile(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> CyclingProfile:
    """Get or create a cycling profile for the user."""
    result = await db.execute(
        select(CyclingProfile).where(CyclingProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if profile:
        return profile

    profile = CyclingProfile(user_id=user_id)
    db.add(profile)
    await db.flush()
    return profile


# ── Reference weight ─────────────────────────────────────────────────────────

# Same-day tie-break mirrors the read-time dedup in GET /metrics/weight:
# a direct scale measurement beats an estimate beats a manual entry.
_WEIGHT_SOURCE_PRIORITY = {"withings": 0, "whoop": 1, "manual": 2}


async def sync_profile_reference_weight(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> float | None:
    """Set ``CyclingProfile.weight_kg`` to the latest known body weight.

    Single source of truth for every consumer of reference body weight
    (W/kg charts, strength standards, BW-ratio goals, VO2max): the newest
    ``WeightLog`` row, breaking same-day ties by source reliability
    (Withings > Whoop > manual). Call after any weight write (Withings /
    Whoop sync, manual create / update / delete). Returns the synced
    weight, or None when no weigh-ins exist (profile left untouched).
    """
    result = await db.execute(
        select(WeightLog.date, WeightLog.weight_kilogram, WeightLog.source)
        .where(
            WeightLog.user_id == user_id,
            WeightLog.weight_kilogram.isnot(None),
        )
        .order_by(WeightLog.date.desc())
    )
    rows = result.all()
    if not rows:
        return None
    latest_date = rows[0][0]
    same_day = [r for r in rows if r[0] == latest_date]
    same_day.sort(key=lambda r: _WEIGHT_SOURCE_PRIORITY.get(r[2], 99))
    weight = float(same_day[0][1])
    profile = await get_or_create_cycling_profile(db, user_id)
    profile.weight_kg = weight
    await db.flush()
    return weight
