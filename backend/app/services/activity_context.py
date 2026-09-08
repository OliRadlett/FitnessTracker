"""Precomputed per-activity ride context (§1.3).

The immutable ride analytics that a cycling activity can ever produce from its
streams (power-zone seconds, decoupling, climbing totals, top speed, TSS
breakdown) are computed once — at Strava sync time / on backfill — and stored in
``Activity.context`` (JSONB). The `/activities/{id}/context` read path then
serves them from the cache instead of re-running ``analyze_ride`` + stream reads
on every expanded-card render. ``load_context`` (ATL/CTL/TSB) is deliberately NOT
cached here: it is a moving window that changes with every new ride, so it stays
computed on demand.

Cache staleness: power zones depend on FTP, so the stored context snapshots the
``ftp_watts`` it was computed under and the reader recomputes the moment the
profile FTP differs (a cheap one-query check). Top speed / decoupling / climbing
are FTP-independent and never go stale.
"""

import logging
import uuid
from datetime import UTC, datetime, timezone

from sqlalchemy import select

from app.models.activity import Activity, ActivityStream
from app.models.cycling import CyclingProfile

logger = logging.getLogger(__name__)


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


async def compute_top_speed(db, activity_id: uuid.UUID) -> float | None:
    """Max velocity (km/h) from the activity's velocity stream(s).

    Moved out of api/activities.py so both the sync hook and the /context read
    path share one implementation.
    """
    result = await db.execute(
        select(ActivityStream).where(
            ActivityStream.activity_id == activity_id,
            ActivityStream.stream_type.in_(
                ["velocity", "velocity_smooth", "enhanced_speed"]
            ),
        )
    )
    stream = result.scalar_one_or_none()
    if stream is None:
        return None
    raw = stream.data.get("data", []) if isinstance(stream.data, dict) else []
    values = [float(v) for v in raw if v is not None]
    if not values:
        return None
    max_mps = max(values)
    return round(max_mps * 3.6, 1)


def ride_context_from_analysis(
    analysis: dict,
    top_speed_kmh: float | None,
    ftp_watts: float | None,
    tss_fallback: float | None,
    computed_at: str | None = None,
) -> dict:
    """Pure: project `analyze_ride()` output (+ top speed) into the stored shape.

    Mirrors the old inline mapping in `api/activities.py`.
    """
    power_zones = analysis.get("power_zones", [])
    decoupling = analysis.get("decoupling")
    climbing = analysis.get("climbing_analysis")
    tss_bd = analysis.get("tss_breakdown", {})

    return {
        "ride": {
            "power_zones": [
                {
                    "zone_name": z.get("zone_name", ""),
                    "zone_label": z.get("zone_label", ""),
                    "seconds": z.get("seconds", 0),
                    "pct": z.get("pct", 0),
                }
                for z in power_zones
            ],
            "normalized_power": analysis.get("normalized_power"),
            "intensity_factor": analysis.get("intensity_factor"),
            "variability_index": analysis.get("variability_index"),
            "efficiency_factor": analysis.get("efficiency_factor"),
            "vam": analysis.get("vam"),
            "decoupling_pct": decoupling.get("decoupling_pct") if decoupling else None,
            "decoupling_class": decoupling.get("classification")
            if decoupling
            else None,
            "tss": tss_bd.get("total_tss") if tss_bd else tss_fallback,
            "tss_per_hour": tss_bd.get("tss_per_hour") if tss_bd else None,
            "climbing_meters": climbing.get("total_climbing_m") if climbing else None,
            "top_speed_kmh": top_speed_kmh,
        },
        "ftp_watts": ftp_watts,
        "computed_at": computed_at or _iso_now(),
    }


def context_to_ride_metrics(context: dict | None) -> dict | None:
    """Pure: stored context back into the endpoint's `ride_metrics` dict.

    Returns ``None`` when the stored payload doesn't contain a ride block.
    """
    if not isinstance(context, dict):
        return None
    ride = context.get("ride")
    if not isinstance(ride, dict) or "power_zones" not in ride:
        return None
    return dict(ride)


def should_recompute_for_ftp(context: dict | None, ftp_watts: float | None) -> bool:
    """Pure: power zones were computed under a different FTP → recompute."""
    if not isinstance(context, dict):
        return True
    return context.get("ftp_watts") != ftp_watts


async def compute_activity_context(db, activity: Activity) -> dict | None:
    """Compute (not store) the ride context for a cycling activity.

    Returns ``None`` for non-cycling activities or when analysis was impossible.
    Caller persists (``activity.context = result`` then commit).
    """
    if activity is None or activity.sport_type != "cycling":
        return None

    from app.services.session_analysis import analyze_ride

    analysis = await analyze_ride(db, activity.user_id, activity.id)
    if analysis is None:
        return None

    top_speed = await compute_top_speed(db, activity.id)

    # Read-only profile fetch — never create a profile just for a cache compute.
    profile_result = await db.execute(
        select(CyclingProfile).where(CyclingProfile.user_id == activity.user_id)
    )
    profile = profile_result.scalar_one_or_none()
    ftp = profile.ftp_watts if profile and profile.ftp_watts else None

    return ride_context_from_analysis(analysis, top_speed, ftp, activity.tss)


async def ensure_activity_contexts(db, activities: list[Activity]) -> int:
    """Best-effort compute + assign `context` for all cycling activities given.

    Failures are logged and skipped — missing context is healed later by
    `backfill_activity_context` and the on-read fallback.
    Returns the number of contexts stored.
    """
    stored = 0
    for activity in activities:
        try:
            if activity.sport_type != "cycling":
                continue
            ctx = await compute_activity_context(db, activity)
            if ctx is None:
                continue
            activity.context = ctx
            stored += 1
        except Exception as e:
            logger.warning("Context compute failed for activity %s: %s", activity.id, e)
    return stored


async def ensure_activity_contexts_by_id(db, activity_ids: list[uuid.UUID]) -> int:
    """Load the Activity rows for the ids and run `ensure_activity_contexts`."""
    if not activity_ids:
        return 0
    result = await db.execute(select(Activity).where(Activity.id.in_(activity_ids)))
    return await ensure_activity_contexts(db, list(result.scalars().all()))
