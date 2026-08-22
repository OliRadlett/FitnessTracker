"""Cycling service — CTL/ATL/TSB computation, cycling profile, and metric benchmarks."""

import math
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cycling import CyclingProfile

# ── Constants ────────────────────────────────────────────────────────────────

CTL_DAYS = 42  # Chronic Training Load time constant
ATL_DAYS = 7  # Acute Training Load time constant


# ── CTL / ATL / TSB ─────────────────────────────────────────────────────────


def compute_training_load(
    daily_tss: dict[date, float],
    end_date: date,
    lookback_days: int = 90,
) -> list[dict]:
    """Compute CTL, ATL, and TSB for each day over a lookback period.

    Uses exponentially weighted moving averages:
    CTL_t = CTL_{t-1} + (TSS_t - CTL_{t-1}) × (1 - e^(-1/42))
    ATL_t = ATL_{t-1} + (TSS_t - ATL_{t-1}) × (1 - e^(-1/7))
    TSB_t = CTL_t - ATL_t

    Returns a list of dicts with keys: date, tss, ctl, atl, tsb.
    """
    start_date = end_date - timedelta(days=lookback_days)
    ctl_decay = 1 - math.exp(-1 / CTL_DAYS)
    atl_decay = 1 - math.exp(-1 / ATL_DAYS)

    result = []
    ctl = 0.0
    atl = 0.0

    current = start_date
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
