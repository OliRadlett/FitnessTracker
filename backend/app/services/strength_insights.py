"""Deterministic strength insights over the Jev labels + tonnage.

Descriptive only: these return a *read* (a message plus the numbers behind it),
never a prescription, and never fire without the deterministic signal — the same
escalation contract the tag consumers follow (a label may sharpen a signal,
never create one).
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lifting import LiftingSession

# A deload within this many weeks clears the flag.
DELOAD_ABSENT_WEEKS = 6
# A week-over-week-block rise below this is "holding level", not accumulating.
_RISING_RATIO = 1.05


def deload_verdict(
    tonnage_by_week: dict[str, float],
    deload_dates: list[date],
    today: date,
) -> dict | None:
    """Pure: a rising block with no recent deload → verdict, else None.

    Needs ≥8 weeks of tonnage (so a 4-week window can be compared against the
    prior 4), a rise of ≥5%, and either no deload ever or none within
    ``DELOAD_ABSENT_WEEKS``. Returns None otherwise — including "not enough
    history to tell".
    """
    weeks = sorted(tonnage_by_week)
    if len(weeks) < 8:
        return None
    recent = sum(tonnage_by_week[w] for w in weeks[-4:]) / 4
    prior = sum(tonnage_by_week[w] for w in weeks[-8:-4]) / 4
    if prior <= 0 or recent < prior * _RISING_RATIO:
        return None
    weeks_since = (today - max(deload_dates)).days // 7 if deload_dates else None
    if weeks_since is not None and weeks_since < DELOAD_ABSENT_WEEKS:
        return None
    when = f"{weeks_since} weeks" if weeks_since is not None else "the window"
    return {
        "weeks_since_deload": weeks_since,
        "recent_avg_volume_kg": round(recent, 1),
        "prior_avg_volume_kg": round(prior, 1),
        "message": (
            f"Tonnage has risen for 4+ weeks with no deload in {when} — "
            "consider a lighter week."
        ),
    }


async def deload_adherence(
    db: AsyncSession, user_id: uuid.UUID, weeks: int = 16
) -> dict | None:
    """Query wrapper for :func:`deload_verdict`.

    Returns None when no session in the window is classified: without the
    ``deload`` label we cannot tell a reduce week from a missing one, so the
    insight stays silent rather than guessing.
    """
    cutoff = date.today() - timedelta(weeks=weeks)
    rows = (
        await db.execute(
            select(
                LiftingSession.session_date,
                LiftingSession.total_volume_kg,
                LiftingSession.session_class,
            ).where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= cutoff,
            )
        )
    ).all()
    if not any(cls is not None for _, _, cls in rows):
        return None

    tonnage: dict[str, float] = {}
    for day, vol, _ in rows:
        week = (day - timedelta(days=day.weekday())).isoformat()
        tonnage[week] = tonnage.get(week, 0.0) + float(vol or 0.0)
    deload_dates = [day for day, _, cls in rows if cls == "deload"]
    return deload_verdict(tonnage, deload_dates, date.today())
