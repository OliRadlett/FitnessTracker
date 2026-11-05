"""Gear identity and wear — resolving provider gear ids into real objects.

Strava has always returned ``gear_id`` on every activity summary, and it has been
sitting unread in ``activities.raw_data``. Resolving it turns "which bike was
this" into a query, and makes the one maintenance question a cyclist asks —
how far has this chain or this pair of shoes gone — answerable at all.

Three deliberate constraints:

* **One API call per new gear, one per gear per day.** ``GET /gear/{id}`` is in
  Strava's read bucket (100 per 15 min, 1,000/day by default). A gear's distance
  is a slowly-moving total, so refreshing it on every sync would spend the bucket
  on a number that changed by a single ride.

* **Best effort, never fatal.** Gear resolution runs after the activities are
  stored, and a failure leaves ``activities.gear_id`` NULL — the ride is still
  complete, only its equipment is unknown. The next sync retries, because the
  provider id is still in the payload.

* **No invented thresholds.** ``wear_threshold_meters`` is user-set and NULL by
  default; with it NULL the API reports no wear percentage. A default interval
  would be a number presented as knowledge, and the right interval depends on
  load, conditions and the specific shoe.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.strava_client import strava_client
from app.models.activity import Activity
from app.models.gear import Gear
from app.models.user import OAuthConnection

logger = logging.getLogger(__name__)

# How long a gear's provider distance is trusted before it is fetched again.
GEAR_DISTANCE_TTL = timedelta(hours=24)

# Strava's frame_type codes; present on bikes only.
_FRAME_TYPES = {1, 2, 3, 4}

GEAR_KIND_BIKE = "bike"
GEAR_KIND_OTHER = "other"


def kind_from_payload(payload: dict) -> str:
    """Classify a Strava gear payload as a bike or something else.

    Strava exposes no explicit gear type: ``frame_type`` is present on bikes and
    absent on shoes, and ``name`` is free text (brand + model + nickname). So a
    frame type means bike, and **everything else is "other", never "shoes"** — a
    bike whose owner left the type unset also has no frame type, and guessing
    "shoes" would be confidently wrong on exactly the gear that carries the most
    distance. "other" is the honest answer to "we cannot tell".
    """
    if payload.get("frame_type") in _FRAME_TYPES:
        return GEAR_KIND_BIKE
    return GEAR_KIND_OTHER


def wear_percent(
    distance_meters: float | None, threshold_meters: float | None
) -> float | None:
    """Percentage of a service interval used, or None when either is unknown.

    Not clamped at 100: a gear past its interval should read 140%, not "100% and
    then presumably no worse". The caller renders the overrun.
    """
    if not distance_meters or not threshold_meters or threshold_meters <= 0:
        return None
    return round(distance_meters / threshold_meters * 100, 1)


def remaining_meters(
    distance_meters: float | None, threshold_meters: float | None
) -> float | None:
    """Metres left before the interval, negative when already exceeded."""
    if distance_meters is None or not threshold_meters or threshold_meters <= 0:
        return None
    return round(threshold_meters - distance_meters, 1)


def _is_stale(gear: Gear, now: datetime | None = None) -> bool:
    if gear.distance_synced_at is None:
        return True
    return (now or datetime.now(UTC)) - gear.distance_synced_at >= GEAR_DISTANCE_TTL


async def _find_gear(
    db: AsyncSession, user_id: uuid.UUID, provider_gear_id: str
) -> Gear | None:
    result = await db.execute(
        select(Gear).where(
            Gear.user_id == user_id,
            Gear.provider == "strava",
            Gear.provider_gear_id == provider_gear_id,
        )
    )
    return result.scalar_one_or_none()


def _apply_payload(gear: Gear, payload: dict) -> None:
    """Copy the provider's fields onto a row (insert *or* refresh)."""
    if payload.get("name"):
        gear.name = str(payload["name"])[:255]
    gear.brand_name = (payload.get("brand_name") or None) and str(
        payload["brand_name"]
    )[:120]
    gear.model_name = (payload.get("model_name") or None) and str(
        payload["model_name"]
    )[:120]
    kind = kind_from_payload(payload)
    # Never demote a known bike because a later payload omitted frame_type.
    if gear.kind in (None, GEAR_KIND_OTHER) or kind == GEAR_KIND_BIKE:
        gear.kind = kind
    distance = payload.get("distance")
    if distance is not None:
        gear.distance_meters = float(distance)
    gear.distance_synced_at = datetime.now(UTC)


async def sync_strava_gear(
    db: AsyncSession,
    user_id: uuid.UUID,
    connection: OAuthConnection,
) -> dict[str, int]:
    """Resolve and link every gear id referenced by this user's Strava rides.

    Idempotent: re-running resolves nothing new, refreshes only stale distances,
    and re-links nothing. Safe to call at the end of every sync.

    Returns counts for logging: ``gears`` resolved, ``linked`` activities,
    ``refreshed`` distances, ``errors``.
    """
    stats = {"gears": 0, "linked": 0, "refreshed": 0, "errors": 0}

    gear_id_column = Activity.raw_data["gear_id"].astext
    result = await db.execute(
        select(gear_id_column.label("gid"))
        .where(
            Activity.user_id == user_id,
            gear_id_column.isnot(None),
            # Empty string is what Strava sends when the athlete cleared the gear.
            gear_id_column != "",
        )
        .distinct()
    )
    provider_ids = [row.gid for row in result.all() if row.gid]

    for provider_gear_id in provider_ids:
        gear = await _find_gear(db, user_id, provider_gear_id)
        needs_fetch = gear is None or _is_stale(gear)

        if needs_fetch:
            try:
                payload = await strava_client.get_gear(
                    connection.access_token, provider_gear_id
                )
            except Exception as exc:  # best effort — see module docstring
                stats["errors"] += 1
                logger.warning(
                    "Could not fetch gear %s for user %s: %s",
                    provider_gear_id,
                    user_id,
                    exc,
                )
                continue

            if gear is None:
                gear = Gear(
                    user_id=user_id,
                    provider="strava",
                    provider_gear_id=provider_gear_id,
                    name=str(payload.get("name") or provider_gear_id)[:255],
                    kind=kind_from_payload(payload),
                )
                db.add(gear)
                stats["gears"] += 1
            else:
                stats["refreshed"] += 1
            _apply_payload(gear, payload)
            await db.flush()

        # Link every activity that names this gear and has no FK yet. Doing it in
        # one statement (rather than per activity) keeps a 500-ride backfill to a
        # single UPDATE per gear.
        linked = await db.execute(
            update(Activity)
            .where(
                Activity.user_id == user_id,
                Activity.gear_id.is_(None),
                gear_id_column == provider_gear_id,
            )
            .values(gear_id=gear.id)
        )
        stats["linked"] += linked.rowcount or 0

    await db.flush()
    if any(stats.values()):
        logger.info(
            "Strava gear sync for user %s: %s resolved, %s linked, %s refreshed, "
            "%s failed",
            user_id,
            stats["gears"],
            stats["linked"],
            stats["refreshed"],
            stats["errors"],
        )
    return stats
