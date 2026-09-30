"""Quarantine orphaned routes so they stop polluting matching.

A route with zero linked activities is residue: the surviving half of an
earlier merge, or a lap-variant twin that was absorbed and never cleaned
up. 67 of 108 routes on the live account are in that state. They are not
harmless — every candidate query fetches them, so a new activity can be
matched against a route nothing has ever been ridden on, and the
similarity metric trains negatives against rows that should not count.

Quarantine is deliberately a **soft** exclusion: a ``quarantined_at``
stamp that the candidate queries filter on. Nothing is deleted and
nothing is merged, so clearing the stamp restores the previous behaviour
exactly. That reversibility is the point — course identity is being
recalibrated (ride-course-split Ph. 4), and it must be measured against
a clean pool rather than against residue.

Deliberately *not* filtered here: display paths. A quarantined route is
still the user's route; it shows in the list, keeps its geometry, and can
be restored from the UI. Only the matching paths exclude it.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable, Sequence

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.route import Route

logger = logging.getLogger(__name__)

# A route is quarantinable only at *zero* linked activities. This is the
# safety property: anything a user can still reach is excluded from
# automatic quarantine, so a bug in the counting query can hide a course
# from matching but can never hide one from the user.
QUARANTINE_MIN_ACTIVITIES = 0


def active_routes_clause():
    """SQL predicate for routes eligible to be matched against.

    Used by every candidate query so the filter cannot be forgotten at one
    call site. ``quarantined_at IS NULL`` rather than a boolean flag,
    because the timestamp doubles as the audit of when the route was set
    aside.
    """
    return Route.quarantined_at.is_(None)


def containment(a: set[str], b: set[str]) -> float:
    """Overlap coefficient, ``|A n B| / min(|A|,|B|)``, on OSM way ids.

    Containment rather than Jaccard, because the question is "is this ride
    on that course?" — not "are these the same length?". A short ride
    entirely inside a long course is fully contained; Jaccard would punish
    the course for being long, which is backwards.

    Accepts either way ids (``"123"``) or raw edge ids (``"123:5"``): the
    ``:index`` suffix encodes direction, and a ride and its reverse share
    no edge ids at all, so the suffix is stripped here rather than left as
    a footgun for every caller to remember.
    """
    if not a or not b:
        return 0.0
    sa = _ways(a)
    sb = _ways(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / min(len(sa), len(sb))


def _ways(ids: set[str]) -> set[str]:
    return {i.split(":", 1)[0] for i in ids}


def jaccard(a: set[str], b: set[str]) -> float:
    """Direction-blind Jaccard, used only to break containment ties.

    Containment cannot distinguish "a ride that is the whole course" from
    "a ride that is a short lap of a longer course" — both score 1.0.
    Jaccard separates them, because the larger the union relative to the
    intersection, the less alike the two sets are.
    """
    sa, sb = _ways(a), _ways(b)
    if not sa or not sb:
        return 0.0
    union = len(sa | sb)
    return len(sa & sb) / union if union else 0.0


def way_ids_from_road_match(road_match: dict | None) -> set[str]:
    """Direction-blind way-id set from a stored ``road_match`` payload."""
    if not road_match:
        return set()
    edges = road_match.get("edge_set") or road_match.get("edges") or []
    return {e.split(":")[0] for e in edges if isinstance(e, str) and ":" in e}


def orphan_route_ids(activity_counts: dict[uuid.UUID, int]) -> list[uuid.UUID]:
    """Route ids with no linked activities, in a stable order."""
    return sorted(
        rid
        for rid, count in activity_counts.items()
        if count <= QUARANTINE_MIN_ACTIVITIES
    )


def split_quarantine_decision(
    activity_counts: dict[uuid.UUID, int],
    *,
    dry_run: bool = True,
    already: Iterable[uuid.UUID] = (),
) -> dict:
    """Work out which routes to quarantine, without touching the database.

    Split from the part that writes, so the decision is testable and the
    destructive path has nothing to compute. ``dry_run`` defaults to True
    because the default should be the safe one.
    """
    already_set = set(already)
    considered = len(activity_counts)
    orphans = orphan_route_ids(activity_counts)
    already_present = [r for r in orphans if r in already_set]
    pending = [r for r in orphans if r not in already_set]
    return {
        "considered": considered,
        "to_quarantine": pending,
        "already_quarantined": already_present,
        "kept": considered - len(orphans),
        "would_change": bool(pending),
        "dry_run": dry_run,
    }


async def activity_counts(db: AsyncSession, user_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """Linked-activity count per route, including routes with none.

    A LEFT OUTER JOIN, so routes with zero activities come back as 0
    rather than being absent — an inner join would silently report only
    the routes that are already fine.
    """
    rows = await db.execute(
        select(Route.id, func.count(Activity.id))
        .outerjoin(Activity, Activity.route_id == Route.id)
        .where(Route.user_id == user_id)
        .group_by(Route.id)
    )
    return {rid: int(count) for rid, count in rows.all()}


async def quarantined_route_ids(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    rows = await db.execute(
        select(Route.id).where(
            Route.user_id == user_id, Route.quarantined_at.isnot(None)
        )
    )
    return set(rows.scalars().all())


async def quarantine_orphaned_routes(
    db: AsyncSession, user_id: uuid.UUID, *, dry_run: bool = True
) -> dict:
    """Stamp ``quarantined_at`` on every route with no linked activities.

    Dry run by default. Already-quarantined routes are skipped rather
    than re-stamped, so the original timestamp survives as the audit of
    when the route was actually set aside.
    """
    counts = await activity_counts(db, user_id)
    already = await quarantined_route_ids(db, user_id)
    decision = split_quarantine_decision(counts, dry_run=dry_run, already=already)

    if dry_run or not decision["to_quarantine"]:
        return {**decision, "quarantined_now": 0}

    result = await db.execute(
        update(Route)
        .where(
            Route.user_id == user_id,
            Route.id.in_(decision["to_quarantine"]),
            Route.quarantined_at.is_(None),
        )
        .values(quarantined_at=func.now())
    )
    await db.flush()
    logger.info(f"Quarantined {result.rowcount} orphaned routes for user {user_id}")
    return {**decision, "quarantined_now": int(result.rowcount)}


async def restore_route(db: AsyncSession, route_id: uuid.UUID) -> bool:
    """Clear the stamp. Returns True if a route was actually restored."""
    result = await db.execute(
        update(Route)
        .where(Route.id == route_id, Route.quarantined_at.isnot(None))
        .values(quarantined_at=None)
    )
    await db.flush()
    return result.rowcount > 0


def rank_recovery_candidates(
    orphans: Sequence[dict], live_routes: Sequence[dict]
) -> list[dict]:
    """Rank each orphan against its best live route by way containment.

    Pure, so the ranking that Ph. 4 will be calibrated against can be
    tested without a database. Inputs are dicts with ``id``, ``name`` and
    ``ways`` (a way-id set) — build them with :func:`way_ids_from_road_match`.

    A route appearing in both lists is never matched against itself: its
    containment would trivially be 1.0 and it would top the list for no
    reason. An orphan with no live candidate is still emitted, with
    ``live_id`` None, so nothing disappears silently from the review.
    """
    rows: list[dict] = []
    for orphan in orphans:
        best: dict | None = None
        for live in live_routes:
            if live["id"] == orphan["id"]:
                continue
            score = containment(orphan["ways"], live["ways"])
            # Containment ties are common (a whole-course ride and a
            # single-lap ride both score 1.0), so break them on Jaccard,
            # which prefers the more similar pair overall.
            key = (score, jaccard(orphan["ways"], live["ways"]))
            if best is None or key > (best["containment"], best["jaccard"]):
                best = {
                    "orphan_id": orphan["id"],
                    "orphan_name": orphan["name"],
                    "live_id": live["id"],
                    "live_name": live["name"],
                    "containment": score,
                    "jaccard": key[1],
                }
        if best is None:
            best = {
                "orphan_id": orphan["id"],
                "orphan_name": orphan["name"],
                "live_id": None,
                "live_name": None,
                "containment": 0.0,
                "jaccard": 0.0,
            }
        rows.append(best)
    rows.sort(key=lambda r: (-r["containment"], -r["jaccard"], str(r["orphan_name"])))
    return rows
