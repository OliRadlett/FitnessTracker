"""Withings service — body composition sync from Withings scales.

Fetches grouped scale weigh-ins via ``getmeas`` (category=1), decodes the
``value * 10^unit`` encoding, validates ranges, and upserts into
``WeightLog`` with ``source="withings"``.

Dedup vs Whoop: the ``(user_id, date, source)`` unique constraint lets both
coexist; Withings wins at read time (direct scale measurement vs Whoop
estimation) — see the weight API GET and chart service.
"""

import logging
import time
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.withings_client import withings_client
from app.models.user import OAuthConnection
from app.models.weight import WeightLog

logger = logging.getLogger(__name__)


# ── Measurement type → WeightLog field ────────────────────────────────────────

_MEASTYPE_TO_FIELD: dict[int, str] = {
    1: "weight_kilogram",
    6: "body_fat_percent",
    8: "fat_mass_kg",
    5: "lean_mass_kg",
    76: "muscle_mass_kg",
    88: "bone_mass_kg",
    77: "hydration_percent",
    170: "visceral_fat_index",
}
# Height (type 4) is only used to derive BMI within the same weighing group.
_MEASTYPE_HEIGHT = 4


# ── Outlier detection ─────────────────────────────────────────────────────────

RANGE_VALIDATORS: dict[str, tuple[float, float]] = {
    "weight_kilogram": (20, 300),
    "body_fat_percent": (3, 60),
    "fat_mass_kg": (2, 150),
    "lean_mass_kg": (15, 200),
    "muscle_mass_kg": (10, 150),
    "bone_mass_kg": (0.5, 8),
    "hydration_percent": (30, 80),
    "visceral_fat_index": (1, 59),
    "bmi": (10, 80),
}

# Consecutive-day weight jumps larger than this are logged for user review
# but still stored.
WEIGHT_DELTA_FLAG_KG = 3.0

# Initial import window for brand-new connections (no watermark yet).
# Withings rejects unbounded getmeas calls (API status 503), so a bounded
# window is mandatory — not just an optimization.
INITIAL_SYNC_DAYS = 365


def resolve_startdate(
    last_synced_at: datetime | None,
    startdate: int | None,
    now: int | None = None,
) -> int:
    """Resolve the getmeas ``startdate`` (unix timestamp).

    Priority: explicit caller value → watermark minus 24h overlap →
    initial-import window (new connections).
    """
    if startdate is not None:
        return startdate
    ref = now if now is not None else int(datetime.now(UTC).timestamp())
    if last_synced_at is not None:
        return int((last_synced_at - timedelta(hours=24)).timestamp())
    return ref - INITIAL_SYNC_DAYS * 86400


def decode_measure_value(value: float, unit: int) -> float:
    """Decode Withings value encoding: actual = value * 10^unit."""
    return float(value) * (10 ** int(unit))


def _in_range(field: str, value: float | None) -> bool:
    if value is None:
        return True
    bounds = RANGE_VALIDATORS.get(field)
    if not bounds:
        return True
    return bounds[0] <= value <= bounds[1]


def group_measurements(measuregrps: list[dict]) -> list[dict]:
    """Collapse raw ``measuregrps`` into one dict per weighing (grpid).

    Each dict has ``date`` (UTC date), ``timestamp``, and decoded
    ``WeightLog`` field values (plus ``height_m`` when present for BMI).
    Groups without a valid in-range weight are dropped (a row needs weight).
    Out-of-range composition metrics become ``None`` (weight is kept).
    """
    grouped: list[dict] = []
    for grp in measuregrps:
        if grp.get("category", 1) != 1:
            continue  # category 2 = user-entered goals, not real measurements
        ts = grp.get("date")
        if not ts:
            continue
        fields: dict = {}
        height_m: float | None = None
        for m in grp.get("measures", []):
            mtype = m.get("type")
            try:
                decoded = decode_measure_value(m["value"], m.get("unit", 0))
            except (KeyError, TypeError, ValueError):
                continue
            if mtype == _MEASTYPE_HEIGHT:
                height_m = decoded
            elif mtype in _MEASTYPE_TO_FIELD:
                fields[_MEASTYPE_TO_FIELD[mtype]] = decoded

        weight = fields.get("weight_kilogram")
        if weight is None or not _in_range("weight_kilogram", weight):
            if weight is not None:
                logger.warning(
                    "Withings group %s: weight %.2fkg out of range — skipping group",
                    grp.get("grpid"),
                    weight,
                )
            continue

        # Validate composition metrics individually — drop the metric, keep weight.
        for field, val in list(fields.items()):
            if not _in_range(field, val):
                logger.warning(
                    "Withings group %s: %s=%.2f out of range — storing as None",
                    grp.get("grpid"),
                    field,
                    val,
                )
                fields[field] = None

        # Derive BMI when the same weighing carries height.
        if height_m and height_m > 0:
            bmi = weight / (height_m * height_m)
            fields["bmi"] = bmi if _in_range("bmi", bmi) else None

        dt = datetime.fromtimestamp(int(ts), tz=UTC)
        grouped.append(
            {
                "date": dt.date(),
                "timestamp": int(ts),
                **fields,
            }
        )

    # Multiple weigh-ins on the same day: latest wins (stable order).
    grouped.sort(key=lambda g: g["timestamp"])
    return grouped


# ── Connection helpers ────────────────────────────────────────────────────────


async def get_withings_connection(
    db: AsyncSession, user_id: uuid.UUID
) -> OAuthConnection | None:
    """Get the Withings OAuth connection for a user."""
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == "withings",
        )
    )
    return result.scalar_one_or_none()


async def refresh_if_needed(
    db: AsyncSession, connection: OAuthConnection
) -> OAuthConnection:
    """Refresh the access token if it's expired (hardened path).

    Row-locked and health-state-aware via
    :func:`app.services.connection_health.refresh_connection`.
    """
    from app.services.connection_health import refresh_connection

    return await refresh_connection(db, connection, withings_client)


# ── Main sync ─────────────────────────────────────────────────────────────────


async def sync_withings_measurements(
    db: AsyncSession,
    user_id: uuid.UUID,
    startdate: int | None = None,
    enddate: int | None = None,
) -> list[WeightLog]:
    """Fetch Withings scale measurements and upsert into WeightLog.

    Incremental: when *startdate* is omitted, resumes from the connection's
    ``last_synced_at`` watermark minus 24h overlap, or imports the last
    ``INITIAL_SYNC_DAYS`` days for brand-new connections (Withings rejects
    unbounded queries). The caller owns the watermark update + commit
    (matches the Strava/Whoop task pattern).

    Returns the list of upserted WeightLog records.
    """
    connection = await get_withings_connection(db, user_id)
    if not connection:
        return []

    connection = await refresh_if_needed(db, connection)

    startdate = resolve_startdate(connection.last_synced_at, startdate)
    if enddate is None:
        enddate = int(time.time())

    try:
        payload = await withings_client.get_measurements(
            connection.access_token,
            startdate=startdate,
            enddate=enddate,
        )
    except Exception as e:
        logger.warning(f"Failed to fetch Withings measurements for user {user_id}: {e}")
        return []

    if not isinstance(payload, dict) or payload.get("status", 0) != 0:
        # Withings signals errors in-body (e.g. 503 = unbounded/too-broad
        # query) while still returning HTTP 200 — never silently swallow.
        status = payload.get("status") if isinstance(payload, dict) else None
        logger.warning(
            f"Withings getmeas rejected for user {user_id}: api_status={status}"
        )
        return []

    body = payload.get("body", {}) if isinstance(payload, dict) else {}
    measuregrps = body.get("measuregrps", []) or []
    grouped = group_measurements(measuregrps)

    if not grouped:
        return []

    # Flag large consecutive-day jumps for review (still stored).
    prev_weight: float | None = None
    prev_date: date | None = None
    synced: list[WeightLog] = []
    for g in grouped:
        w = g["weight_kilogram"]
        if (
            prev_weight is not None
            and prev_date is not None
            and (g["date"] - prev_date).days >= 1
            and abs(w - prev_weight) > WEIGHT_DELTA_FLAG_KG
        ):
            logger.warning(
                f"Withings weight jump for user {user_id}: "
                f"{prev_weight:.1f}kg → {w:.1f}kg "
                f"({prev_date} → {g['date']}) — stored for review"
            )
        prev_weight, prev_date = w, g["date"]

        values = {
            "user_id": user_id,
            "date": g["date"],
            "weight_kilogram": w,
            "source": "withings",
            "body_fat_percent": g.get("body_fat_percent"),
            "fat_mass_kg": g.get("fat_mass_kg"),
            "lean_mass_kg": g.get("lean_mass_kg"),
            "muscle_mass_kg": g.get("muscle_mass_kg"),
            "bone_mass_kg": g.get("bone_mass_kg"),
            "hydration_percent": g.get("hydration_percent"),
            "visceral_fat_index": g.get("visceral_fat_index"),
            "bmi": g.get("bmi"),
        }
        stmt = (
            pg_insert(WeightLog)
            .values(**values)
            .on_conflict_do_update(
                index_elements=["user_id", "date", "source"],
                set_={k: v for k, v in values.items() if k not in ("user_id", "date")},
            )
            .returning(WeightLog)
        )
        result = await db.execute(stmt)
        row = result.scalar_one_or_none()
        if row:
            synced.append(row)

    await db.flush()
    logger.info(f"Withings sync for user {user_id}: {len(synced)} weigh-ins upserted")

    if synced:
        # Keep the canonical reference weight (W/kg, strength standards,
        # BW-ratio goals) in sync with scale weigh-ins — QW1.
        from app.services.cycling import sync_profile_reference_weight

        await sync_profile_reference_weight(db, user_id)

    return synced
