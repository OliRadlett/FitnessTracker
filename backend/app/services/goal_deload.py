"""Deload-aware goal progress (P2).

A deload week — training load cut roughly in half — is programmed recovery,
not regression. Goal machinery that ignores it misreads the week two ways:
the trend regression fits a depressed check-in as lost adaptation, and the
alignment score burns schedule for days the athlete was never meant to
progress on.

This module detects deload weeks from training load (activity TSS + lifting
session TSS, Monday-aligned ISO weeks) and exposes them to the goal
services: ``compute_goal_projection`` skips deload-week check-ins in its
regression, and ``alignment_pct`` excludes deload days from elapsed time.
Both are fail-open: with no load history there are no deload weeks and every
caller behaves exactly as before.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

#: Trailing weeks averaged for the baseline an deload week is measured against.
DELOAD_BASELINE_WEEKS = 4
#: A week under this fraction of its baseline counts as a deload.
DELOAD_DROP_RATIO = 0.5
#: Baselines under this weekly load are rest, not training — a quiet week
#: after nothing is not a deload (and a new user must never be "deloading").
DELOAD_MIN_BASELINE = 60.0


# ── Pure helpers (unit-testable) ───────────────────────────────────────────


def monday_of(d: date) -> date:
    """ISO week start (Monday) for *d*."""
    return d - timedelta(days=d.weekday())


def detect_deload_weeks(
    weekly_load: list[tuple[date, float]],
    *,
    baseline_weeks: int = DELOAD_BASELINE_WEEKS,
    drop_ratio: float = DELOAD_DROP_RATIO,
    min_baseline: float = DELOAD_MIN_BASELINE,
) -> list[date]:
    """Return the week-starts (Mondays) that read as deload weeks.

    *weekly_load* is ``(week_start, load)`` in ascending order. A week is a
    deload when its load is under ``drop_ratio`` × the mean of the
    ``baseline_weeks`` preceding weeks, provided at least two of those weeks
    carried load and their mean clears ``min_baseline``. Zero-history users
    therefore never deload — the guard degrades open.
    """
    by_week = {week: load for week, load in weekly_load}
    weeks = sorted(by_week)
    deloads: list[date] = []
    for i, week in enumerate(weeks):
        prior = [by_week[w] for w in weeks[max(0, i - baseline_weeks) : i]]
        trained = [load for load in prior if load > 0]
        if len(trained) < 2:
            continue
        baseline = sum(trained) / len(trained)
        if baseline < min_baseline:
            continue
        if by_week[week] < drop_ratio * baseline:
            deloads.append(week)
    return deloads


def deload_days_in_range(deload_weeks: set[date], start: date, end: date) -> int:
    """Whole deload days (7 per deload-week Monday) within [start, end]."""
    if end < start:
        return 0
    span_days = (end - start).days + 1
    days = sum(7 for monday in deload_weeks if start <= monday <= end)
    return min(days, span_days)


# ── DB-backed helpers ──────────────────────────────────────────────────────


async def weekly_training_load(
    db: AsyncSession,
    user_id: uuid.UUID,
    since: date,
    until: date,
) -> list[tuple[date, float]]:
    """Monday-aligned weekly load (activity TSS + lifting session TSS).

    Covers both sports surfaces so lifting-only users deload-detect too.
    Weeks with no load are returned as 0.0 — the detector needs the zeros
    to tell "rest week after training" from "no history".
    """
    from app.models.activity import Activity
    from app.models.lifting import LiftingSession
    from app.services.cycling.tss import get_daily_tss

    daily = await get_daily_tss(db, user_id, since, until)

    result = await db.execute(
        select(LiftingSession.session_date, LiftingSession.estimated_tss).where(
            LiftingSession.user_id == user_id,
            LiftingSession.session_date >= since,
            LiftingSession.session_date <= until,
            LiftingSession.estimated_tss.isnot(None),
        )
    )
    for session_date, tss in result.all():
        if tss:
            daily[session_date] = daily.get(session_date, 0.0) + float(tss)

    totals: dict[date, float] = {}
    day = monday_of(since)
    last = monday_of(until)
    while day <= last:
        totals[day] = 0.0
        day += timedelta(weeks=1)
    for d, load in daily.items():
        totals[monday_of(d)] = totals.get(monday_of(d), 0.0) + float(load or 0.0)
    return sorted(totals.items())


async def deload_week_starts(
    db: AsyncSession,
    user_id: uuid.UUID,
    since: date,
    until: date,
) -> set[date]:
    """Deload-week Mondays within [since, until] for *user_id* (fail-open).

    Pulls four extra baseline weeks ahead of *since* so early weeks in range
    can still detect. Never raises — a detection failure returns no deloads
    rather than breaking the goal read path.
    """
    try:
        baseline_since = since - timedelta(weeks=DELOAD_BASELINE_WEEKS)
        weekly = await weekly_training_load(db, user_id, baseline_since, until)
        detected = detect_deload_weeks(weekly)
        return {week for week in detected if week >= monday_of(since)}
    except Exception:
        logger.warning("Deload detection failed for user %s", user_id, exc_info=True)
        return set()
