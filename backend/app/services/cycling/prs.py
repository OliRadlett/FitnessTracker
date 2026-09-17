"""Cycling power PRs — personal record detection for power duration buckets.

Mirrors the lifting PR pattern (``_check_and_record_pr`` in
``services/lifting.py``) but adapted for cycling power metrics.

Durations tracked: all 14 POWER_DURATION_BUCKETS (5s–120min) + peak
``max`` (1-second instantaneous power from Strava's ``max_watts``).

Notifications fire only on the 5 canonical Coggan reference durations
(5s, 1min, 5min, 20min, 60min) and max — the physiologically significant
benchmarks — to avoid spamming users on every minor bucket improvement.
"""

import logging
import math
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity, ActivityStream
from app.models.cycling import CyclingPowerRecord, CyclingProfile
from app.services.cycling.power_curve import (
    POWER_DURATION_BUCKETS,
    best_power_rolling_average,
)

logger = logging.getLogger(__name__)

# Durations that trigger a PR notification (the 5 canonical Coggan reference
# points + peak max). Others are still tracked/stored but stay silent.
NOTIFICATION_DURATIONS: set[int] = {5, 60, 300, 1200, 3600}


def _duration_label(duration_sec: int) -> str:
    """Map a duration in seconds to the human-readable bucket label."""
    if duration_sec == 1:
        return "max"
    labels = {k: v for k, v in [(5, "5s"), (10, "10s"), (15, "15s"), (30, "30s"),
                                (60, "1min"), (120, "2min"), (300, "5min"),
                                (600, "10min"), (1200, "20min"), (1800, "30min"),
                                (2700, "45min"), (3600, "60min"), (5400, "90min"),
                                (7200, "120min")]}
    return labels.get(duration_sec, f"{duration_sec}s")


# ── Power curve computation (single activity) ─────────────────────────────────


async def _get_activity_power_data(
    db: AsyncSession, activity_id: uuid.UUID
) -> list[float] | None:
    """Extract the power (watts) data array from an activity's stream.

    Returns ``None`` if no power stream exists.
    """
    result = await db.execute(
        select(ActivityStream).where(
            ActivityStream.activity_id == activity_id,
            ActivityStream.stream_type.in_(["watts", "power"]),
        )
    )
    stream = result.scalar_one_or_none()
    if stream is None:
        return None
    if isinstance(stream.data, dict):
        raw = stream.data.get("data", [])
    else:
        raw = stream.data or []
    return [float(p) for p in raw if p is not None and float(p) > 0]


async def compute_activity_power_curve(
    db: AsyncSession, activity_id: uuid.UUID
) -> dict[int, float]:
    """Compute the best power at each duration bucket for a single activity.

    Returns a dict mapping duration_seconds -> best_power_watts.
    Also includes ``1`` for peak instantaneous (max) power.
    """
    power_data = await _get_activity_power_data(db, activity_id)
    if not power_data or len(power_data) < 2:
        return {}

    result: dict[int, float] = {}
    n = len(power_data)

    # Peak instantaneous power (1-second max)
    result[1] = max(power_data)

    sorted_buckets = sorted(POWER_DURATION_BUCKETS, key=lambda b: b[0])
    for duration_sec, _ in sorted_buckets:
        if duration_sec > n:
            break
        best_avg = best_power_rolling_average(power_data, duration_sec)
        if best_avg is not None:
            result[duration_sec] = best_avg

    return result


# ── PR checking (per-activity) ────────────────────────────────────────────────


async def _get_user_weight_kg(
    db: AsyncSession, user_id: uuid.UUID
) -> float | None:
    """Fetch the user's current weight from their cycling profile."""
    result = await db.execute(
        select(CyclingProfile.weight_kg).where(CyclingProfile.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def _get_existing_pr(
    db: AsyncSession, user_id: uuid.UUID, duration_label: str
) -> CyclingPowerRecord | None:
    result = await db.execute(
        select(CyclingPowerRecord).where(
            CyclingPowerRecord.user_id == user_id,
            CyclingPowerRecord.duration_label == duration_label,
        )
    )
    return result.scalar_one_or_none()


async def _save_pr(
    db: AsyncSession,
    user_id: uuid.UUID,
    duration_label: str,
    duration_seconds: int,
    power_watts: float,
    activity: Activity,
    weight_kg: float | None,
    improvement_pct: float | None,
) -> CyclingPowerRecord:
    """Create or update a CyclingPowerRecord, returning the result.

    Also computes w_per_kg from the snapshotted weight.
    """
    existing = await _get_existing_pr(db, user_id, duration_label)

    w_per_kg = None
    if weight_kg and weight_kg > 0:
        w_per_kg = round(power_watts / weight_kg, 2)

    if existing:
        existing.power_watts = power_watts
        existing.duration_seconds = duration_seconds
        existing.achieved_date = activity.start_date.date()
        existing.activity_id = activity.id
        existing.activity = activity
        existing.weight_kg = weight_kg
        existing.w_per_kg = w_per_kg
        existing.improvement_pct = improvement_pct
        return existing
    else:
        pr = CyclingPowerRecord(
            user_id=user_id,
            duration_label=duration_label,
            duration_seconds=duration_seconds,
            power_watts=power_watts,
            weight_kg=weight_kg,
            w_per_kg=w_per_kg,
            improvement_pct=improvement_pct,
            achieved_date=activity.start_date.date(),
            activity_id=activity.id,
        )
        db.add(pr)
        await db.flush()
        pr.activity = activity
        return pr


async def _notify_cycling_pr(
    db: AsyncSession,
    user_id: uuid.UUID,
    pr: CyclingPowerRecord,
    previous_power: float | None,
) -> None:
    """Fire a PR notification for the key durations only."""
    if pr.duration_seconds not in NOTIFICATION_DURATIONS:
        return

    from app.services.notifications import notify

    wkg = f" ({pr.w_per_kg} W/kg)" if pr.w_per_kg else ""
    body = f"{pr.duration_label}: {pr.power_watts:.0f} W{wkg}"
    if previous_power is not None:
        body += f" (was {previous_power:.0f} W)"

    await notify(
        db,
        user_id,
        type="pr",
        title=f"{pr.duration_label} Power PR",
        body=body,
        severity="success",
        link="/cycling",
        dedup_key=f"pr:cycling:{pr.duration_label}:{pr.achieved_date}",
        metadata={
            "duration_label": pr.duration_label,
            "duration_seconds": pr.duration_seconds,
            "power_watts": pr.power_watts,
        },
    )


async def check_and_record_cycling_prs(
    db: AsyncSession,
    user_id: uuid.UUID,
    activity: Activity,
) -> list[CyclingPowerRecord]:
    """Check a single cycling activity for new power PRs.

    Called after a new activity is synced and its power stream is stored.
    Computes the activity's best power at each duration bucket and compares
    against stored PRs. Creates or updates records for any beaten bests,
    firing notifications on the canonical Coggan reference durations.

    Returns the list of PRs that were created or updated.
    """
    if activity.sport_type != "cycling":
        return []

    power_curve = await compute_activity_power_curve(db, activity.id)
    if not power_curve:
        return []

    weight_kg = await _get_user_weight_kg(db, user_id)
    updated_prs: list[CyclingPowerRecord] = []

    for duration_sec, power_watts in sorted(
        power_curve.items(), key=lambda x: x[0]
    ):
        label = _duration_label(duration_sec)
        existing = await _get_existing_pr(db, user_id, label)

        if existing and existing.power_watts >= power_watts:
            continue

        previous_power = existing.power_watts if existing else None
        improvement_pct = None
        if previous_power is not None and previous_power > 0:
            improvement_pct = round(
                ((power_watts - previous_power) / previous_power) * 100, 1
            )

        pr = await _save_pr(
            db, user_id, label, duration_sec, power_watts,
            activity, weight_kg, improvement_pct,
        )
        await db.flush()
        await _notify_cycling_pr(
            db, user_id, pr, previous_power
        )
        updated_prs.append(pr)

    return updated_prs


# ── Full rescan (backfill / manual check) ────────────────────────────────────


async def check_cycling_prs_all_activities(
    db: AsyncSession, user_id: uuid.UUID
) -> list[CyclingPowerRecord]:
    """Scan all cycling activities and update PRs from the all-time bests.

    Used by the weekly backfill task and the manual ``POST /prs/check``
    endpoint. Recomputes the full power curve (which activity produced each
    best) and reconciles against stored PRs.

    This catches PRs that were missed during sync (e.g. activities whose
    streams were backfilled later) and also corrects PRs whose source activity
    has been superseded by a stronger effort.
    """
    power_with_activity = await _compute_power_curve_alltime(db, user_id)
    if not power_with_activity:
        return []

    weight_kg = await _get_user_weight_kg(db, user_id)
    updated_prs: list[CyclingPowerRecord] = []

    for duration_sec, (best_power, activity_id, activity_date) in power_with_activity.items():
        label = _duration_label(duration_sec)

        # Fetch the activity for date/activity linkage
        activity = await db.get(Activity, activity_id) if activity_id else None
        if not activity:
            continue

        existing = await _get_existing_pr(db, user_id, label)

        if existing and existing.power_watts >= best_power:
            # Stored PR is still the best — no change needed
            continue

        previous_power = existing.power_watts if existing else None
        improvement_pct = None
        if previous_power is not None and previous_power > 0:
            improvement_pct = round(
                ((best_power - previous_power) / previous_power) * 100, 1
            )

        pr = await _save_pr(
            db, user_id, label, duration_sec, best_power,
            activity, weight_kg, improvement_pct,
        )
        await db.flush()
        await _notify_cycling_pr(db, user_id, pr, previous_power)
        updated_prs.append(pr)

    return updated_prs


async def _compute_power_curve_alltime(
    db: AsyncSession, user_id: uuid.UUID
) -> dict[int, tuple[float, uuid.UUID, date]]:
    """Compute the all-time best power at each duration bucket.

    Like ``compute_power_curve_from_streams`` but tracks which activity
    (id + start_date) produced each best, so PRs can link back to their source.

    Returns a dict mapping duration_seconds -> (best_power_watts, activity_id, activity_date).
    """
    from datetime import timedelta

    cutoff = date.today() - timedelta(days=3650)  # ~10 years all-time

    result = await db.execute(
        select(Activity.id, Activity.start_date).where(
            Activity.user_id == user_id,
            Activity.sport_type == "cycling",
            Activity.average_power.isnot(None),
            Activity.start_date >= cutoff,
        )
    )
    activities = result.fetchall()

    if not activities:
        return {}

    activity_ids = [row[0] for row in activities]
    activity_dates = {row[0]: row[1] for row in activities}

    result = await db.execute(
        select(ActivityStream).where(
            ActivityStream.activity_id.in_(activity_ids),
            ActivityStream.stream_type.in_(["watts", "power"]),
        )
    )
    streams = list(result.scalars().all())

    best_power: dict[int, tuple[float, uuid.UUID, date]] = {}

    sorted_buckets = sorted(POWER_DURATION_BUCKETS, key=lambda b: b[0])

    for stream in streams:
        data = stream.data.get("data", []) if isinstance(stream.data, dict) else []
        if not data or len(data) < 2:
            continue

        power_data = [float(p) for p in data if p is not None and float(p) > 0]
        n = len(power_data)
        if n < 2:
            continue

        activity_id = stream.activity_id
        activity_date = activity_dates.get(activity_id, date.today())

        # Max (1s peak)
        peak = max(power_data)
        if 1 not in best_power or peak > best_power[1][0]:
            best_power[1] = (peak, activity_id, activity_date)

        for duration_sec, _ in sorted_buckets:
            if duration_sec > n:
                break
            best_avg = best_power_rolling_average(power_data, duration_sec)
            if best_avg is None:
                continue
            if duration_sec not in best_power or best_avg > best_power[duration_sec][0]:
                best_power[duration_sec] = (best_avg, activity_id, activity_date)

    return best_power


# ── Manual PR entry ──────────────────────────────────────────────────────────


async def create_manual_cycling_pr(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: "CyclingPowerRecordCreate",
) -> CyclingPowerRecord:
    """Create or update a cycling power PR manually.

    Mirrors ``create_manual_pr()`` in ``services/lifting.py``.
    """
    from app.schemas.cycling import CyclingPowerRecordCreate

    label = data.duration_label

    existing = await _get_existing_pr(db, user_id, label)

    weight_kg = await _get_user_weight_kg(db, user_id)
    w_per_kg = None
    if weight_kg and weight_kg > 0 and data.power_watts:
        w_per_kg = round(data.power_watts / weight_kg, 2)

    if existing and existing.power_watts > data.power_watts:
        return existing

    improvement_pct = None
    if existing and existing.power_watts > 0:
        improvement_pct = round(
            ((data.power_watts - existing.power_watts) / existing.power_watts) * 100, 1
        )

    if existing:
        existing.power_watts = data.power_watts
        existing.duration_seconds = data.duration_seconds
        existing.achieved_date = data.achieved_date
        existing.notes = data.notes
        existing.weight_kg = weight_kg
        existing.w_per_kg = w_per_kg
        existing.improvement_pct = improvement_pct
        return existing
    else:
        pr = CyclingPowerRecord(
            user_id=user_id,
            duration_label=label,
            duration_seconds=data.duration_seconds,
            power_watts=data.power_watts,
            weight_kg=weight_kg,
            w_per_kg=w_per_kg,
            improvement_pct=improvement_pct,
            achieved_date=data.achieved_date,
            notes=data.notes,
        )
        db.add(pr)
        await db.flush()
        return pr


# ── Listing ──────────────────────────────────────────────────────────────────


async def get_cycling_prs(
    db: AsyncSession,
    user_id: uuid.UUID,
    duration_label: str | None = None,
    limit: int = 50,
) -> list[CyclingPowerRecord]:
    """List the user's cycling power PRs.

    Ordered by duration_seconds ascending (5s → 120min + max).
    """
    query = (
        select(CyclingPowerRecord)
        .options(selectinload(CyclingPowerRecord.activity))
        .where(CyclingPowerRecord.user_id == user_id)
        .order_by(CyclingPowerRecord.duration_seconds.asc())
    )
    if duration_label:
        query = query.where(CyclingPowerRecord.duration_label == duration_label)
    if limit:
        query = query.limit(limit)

    result = await db.execute(query)
    return list(result.scalars().all())
