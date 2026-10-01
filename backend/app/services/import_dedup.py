"""Duplicate detection for file imports.

``import_fit`` created ``Activity(source='manual', …)`` with no
``provider_activity_id`` and no ``connection_id``, so nothing could be
deduplicated on: uploading the same file twice produced two rows, and every
load-bearing aggregate then counted that ride twice.

Two tiers, because neither alone is sufficient:

* **Exact** — sha256 of the file bytes. Catches re-uploading the same export.
  Stored on ``Activity.import_fingerprint`` (migration 093) under a *partial*
  unique index, so the thousands of provider rows with a NULL fingerprint
  cannot collide.
* **Fuzzy** — same sport, ``start_date`` within ±5 min, ``duration_seconds``
  and ``distance_meters`` each within 1%. Catches the same ride re-exported
  by different software, or downloaded from Strava as well as imported from
  the head unit. Thresholds mirror ``merge_service``'s existing approach, so
  they are not invented here.

A fuzzy match **attaches an ``ActivitySource``** rather than discarding the
upload: provenance is preserved, the merge is reversible, and it composes
with pitfall 21's rule (key on provenance, never rewrite a mutable field).
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity, ActivitySource
from app.models.lifting import LiftingSession

# ``_enrich_activity_read`` reads ``route``, ``sources`` and
# ``lifting_session`` off the returned activity. Lazy loading is illegal in an
# async context, so a duplicate returned without these eager-loaded would blow
# up on access — which is exactly the shape this lookup produces. Mirrors the
# selectinload set the create path re-queries with.
_DUPLICATE_LOAD_OPTIONS = (
    selectinload(Activity.lifting_session).selectinload(LiftingSession.sets),
    selectinload(Activity.sources),
    selectinload(Activity.route),
)

# A re-exported ride rarely starts at the identical second — clocks drift and
# some tools round to the minute. Five minutes is tight enough that a false
# positive would require two genuinely separate sessions of the same sport
# within five minutes of each other, which is not a real training pattern.
FUZZY_START_WINDOW = timedelta(minutes=5)
# Duration and distance within 1%. Device and software rounding produces
# differences far below this, while two distinct rides of the same sport
# essentially never land that close.
FUZZY_TOLERANCE = 0.01

# ActivitySource.provider value for a file import. Distinct from every sync
# provider so provenance reads clearly in the UI and in exports.
IMPORT_PROVIDER = "import"


@dataclass(frozen=True)
class DuplicateMatch:
    """Why an upload was judged a duplicate, and what already exists."""

    activity: Activity
    exact: bool
    #: True when an ActivitySource was attached rather than a new row created.
    attached: bool = False


def file_fingerprint(raw: bytes) -> str:
    """Content hash of an uploaded file. Stable across re-uploads."""
    return hashlib.sha256(raw).hexdigest()


def _within(actual: float | None, expected: float | None, tolerance: float) -> bool:
    """True when two measurements agree within a relative tolerance.

    Returns True when either side is missing: a file that carries no distance
    (an indoor trainer session, say) cannot be distinguished from another by
    distance, so it must not be treated as a mismatch. The other two criteria
    still have to agree.
    """
    if actual is None or expected is None:
        return True
    if expected == 0:
        return actual == 0
    return abs(actual - expected) <= abs(expected) * tolerance


async def find_duplicate(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    fingerprint: str | None,
    sport_type: str,
    start_date: datetime | None,
    duration_seconds: int | None,
    distance_meters: float | None,
) -> DuplicateMatch | None:
    """Return an existing activity that this upload duplicates, if any.

    Exact tier first: it is a single indexed lookup and is authoritative when it
    hits. Only when it misses does the fuzzy tier run, which is a range scan.
    """
    if fingerprint:
        result = await db.execute(
            select(Activity)
            .options(*_DUPLICATE_LOAD_OPTIONS)
            .where(
                Activity.user_id == user_id,
                Activity.import_fingerprint == fingerprint,
            )
        )
        exact_hit = result.scalar_one_or_none()
        if exact_hit is not None:
            return DuplicateMatch(activity=exact_hit, exact=True)

    if start_date is None:
        return None

    result = await db.execute(
        select(Activity)
        .options(*_DUPLICATE_LOAD_OPTIONS)
        .where(
            Activity.user_id == user_id,
            Activity.sport_type == sport_type,
            Activity.start_date >= start_date - FUZZY_START_WINDOW,
            Activity.start_date <= start_date + FUZZY_START_WINDOW,
        )
    )

    for candidate in result.scalars().all():
        if not _within(candidate.duration_seconds, duration_seconds, FUZZY_TOLERANCE):
            continue
        if not _within(candidate.distance_meters, distance_meters, FUZZY_TOLERANCE):
            continue
        return DuplicateMatch(activity=candidate, exact=False)

    return None


async def attach_import_source(
    db: AsyncSession,
    activity: Activity,
    *,
    fingerprint: str,
) -> bool:
    """Record that this file is another source for an existing activity.

    Returns True when a row was added, False when this exact file was already
    recorded — so re-importing the same file twice does not accumulate duplicate
    provenance rows.

    The fingerprint doubles as ``provider_activity_id`` rather than a device
    serial or a nullable field: that column is non-nullable and unique per
    ``(activity_id, provider, provider_activity_id)``, and a content hash
    satisfies both while staying stable across re-exports.

    Attaching rather than discarding is what makes a fuzzy match reversible: the
    original activity and its history survive, and the import is visible as
    evidence rather than silently dropped.
    """
    existing = await db.execute(
        select(ActivitySource.id).where(
            ActivitySource.activity_id == activity.id,
            ActivitySource.provider == IMPORT_PROVIDER,
            ActivitySource.provider_activity_id == fingerprint,
        )
    )
    if existing.scalar_one_or_none() is not None:
        return False

    db.add(
        ActivitySource(
            activity_id=activity.id,
            provider=IMPORT_PROVIDER,
            provider_activity_id=fingerprint,
        )
    )
    await db.flush()
    return True
