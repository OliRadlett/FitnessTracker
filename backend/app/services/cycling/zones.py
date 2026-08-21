"""Cycling service — power zones and heart rate zones computation."""

import math
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity, ActivityStream

# Power zones as % of FTP (Andy Coggan model)
POWER_ZONES = [
    ("Z1", "Active Recovery", 0.0, 0.55),
    ("Z2", "Endurance", 0.55, 0.75),
    ("Z3", "Tempo", 0.75, 0.90),
    ("Z4", "Threshold", 0.90, 1.05),
    ("Z5", "VO2max", 1.05, 1.20),
    ("Z6", "Anaerobic", 1.20, 1.50),
    ("Z7", "Neuromuscular", 1.50, 5.0),
]

# Heart Rate zones
HR_ZONES = [
    ("Z1", "Active Recovery", 0.0, 0.68),
    ("Z2", "Endurance", 0.68, 0.83),
    ("Z3", "Tempo", 0.83, 0.95),
    ("Z4", "Threshold", 0.95, 1.05),
    ("Z5", "VO2max", 1.05, 1.18),
    ("Z6", "Anaerobic", 1.18, 5.0),
]

# LTHR-based HR zones (Andy Coggan model for HR)
LTHR_HR_ZONES = [
    ("Z1", "Recovery", 0.00, 0.80),
    ("Z2", "Aerobic", 0.80, 0.89),
    ("Z3", "Tempo", 0.89, 0.95),
    ("Z4", "Threshold", 0.95, 1.05),
    ("Z5", "VO2max", 1.05, 5.0),
]


def compute_hr_zones_from_lthr(lthr: float) -> list[dict]:
    """Compute HR zone boundaries from Lactate Threshold Heart Rate.

    Returns a list of zone dicts with zone id, name, lower/upper HR bounds.
    Pure function — no database access needed.
    """
    if not lthr or lthr <= 0:
        return []

    zones = []
    for zone_id, zone_name, lower_pct, upper_pct in LTHR_HR_ZONES:
        zones.append({
            "zone": zone_id,
            "zone_name": zone_name,
            "lower_bound_hr": round(lthr * lower_pct),
            "upper_bound_hr": round(lthr * upper_pct) if upper_pct < 5.0 else round(lthr * 1.3),
        })
    return zones


async def compute_hr_zones_from_streams(
    db: AsyncSession,
    user_id: uuid.UUID,
    lthr: float,
    days: int = 30,
) -> list[dict]:
    """Compute heart rate zone distribution from HR stream data.

    Uses LTHR (Lactate Threshold Heart Rate) based zones.
    """
    if not lthr or lthr <= 0:
        return []

    cutoff = date.today() - timedelta(days=days)

    result = await db.execute(
        select(Activity.id)
        .where(
            Activity.user_id == user_id,
            Activity.average_heartrate.isnot(None),
            Activity.start_date >= cutoff,
        )
    )
    activity_ids = [row[0] for row in result.all()]

    if not activity_ids:
        return []

    result = await db.execute(
        select(ActivityStream)
        .where(
            ActivityStream.activity_id.in_(activity_ids),
            ActivityStream.stream_type == "heartrate",
        )
    )
    streams = list(result.scalars().all())

    zone_times: dict[str, int] = {z[0]: 0 for z in HR_ZONES}

    for stream in streams:
        data = stream.data.get("data", []) if isinstance(stream.data, dict) else []
        resolution = stream.resolution or 1

        for val in data:
            if val is None:
                continue
            hr = float(val)
            if not math.isfinite(hr) or hr <= 0:
                continue

            pct_lthr = hr / lthr
            for zone_id, _, lower, upper in HR_ZONES:
                if lower <= pct_lthr < upper:
                    zone_times[zone_id] += resolution
                    break
            else:
                zone_times["Z6"] += resolution

    total_time = sum(zone_times.values()) or 1

    zones = []
    for zone_id, zone_name, lower, upper in HR_ZONES:
        time_s = zone_times.get(zone_id, 0)
        zones.append({
            "zone": zone_id,
            "zone_name": zone_name,
            "lower_bound_hr": round(lthr * lower),
            "upper_bound_hr": round(lthr * upper),
            "time_seconds": time_s,
            "percentage": round(time_s / total_time * 100, 1),
        })

    return zones


async def compute_power_zones_from_streams(
    db: AsyncSession,
    user_id: uuid.UUID,
    ftp: float,
    days: int = 30,
) -> list[dict]:
    """Compute power zone distribution from stream data.

    Returns time spent in each zone as seconds and percentage.
    """
    if not ftp or ftp <= 0:
        return []

    cutoff = date.today() - timedelta(days=days)

    result = await db.execute(
        select(Activity.id)
        .where(
            Activity.user_id == user_id,
            Activity.sport_type == "cycling",
            Activity.average_power.isnot(None),
            Activity.start_date >= cutoff,
        )
    )
    activity_ids = [row[0] for row in result.all()]

    if not activity_ids:
        return []

    result = await db.execute(
        select(ActivityStream)
        .where(
            ActivityStream.activity_id.in_(activity_ids),
            ActivityStream.stream_type == "watts",
        )
    )
    streams = list(result.scalars().all())

    # Zone time counters (in seconds, each sample = 1 second assuming 1s resolution)
    zone_times: dict[str, int] = {z[0]: 0 for z in POWER_ZONES}

    for stream in streams:
        data = stream.data.get("data", []) if isinstance(stream.data, dict) else []
        resolution = stream.resolution or 1

        for val in data:
            if val is None:
                continue
            power = float(val)
            if not math.isfinite(power) or power <= 0:
                continue

            pct_ftp = power / ftp
            for zone_id, _, lower, upper in POWER_ZONES:
                if lower <= pct_ftp < upper:
                    zone_times[zone_id] += resolution
                    break
            else:
                # Above Z7
                zone_times["Z7"] += resolution

    total_time = sum(zone_times.values()) or 1

    zones = []
    for zone_id, zone_name, lower, upper in POWER_ZONES:
        time_s = zone_times.get(zone_id, 0)
        zones.append({
            "zone": zone_id,
            "zone_name": zone_name,
            "lower_bound_watts": round(ftp * lower, 1),
            "upper_bound_watts": round(ftp * upper, 1),
            "time_seconds": time_s,
            "percentage": round(time_s / total_time * 100, 1),
        })

    return zones
