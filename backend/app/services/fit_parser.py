"""FIT file parser — extract session data and time-series streams from .fit files.

Uses the ``fitparse`` library to decode Garmin ANT+ FIT files into a
structured dict compatible with Activity and ActivityStream models.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from fitparse import FitFile


# FIT files store lat/lon as semicircles; convert to degrees.
_SEMICIRCLE_TO_DEG = 180.0 / (2 ** 31)

# FIT sport-type enum values we recognise → internal sport_type strings.
_SPORT_MAP: dict[int, str] = {
    0: "cycling",       # generic
    1: "running",       # running
    2: "cycling",       # cycling (explicit)
    3: "walking",       # walking / transition
    4: "cycling",       # cycling — keep default for unknown sub_sport
    5: "cycling",       # cycling
    11: "swimming",     # swimming
    17: "weighttraining",  # strength_training
}


def _safe_float(value: Any) -> float | None:
    """Convert a FIT field value to float, returning None for invalid / missing."""
    if value is None:
        return None
    try:
        v = float(value)
        return None if (math.isnan(v) or math.isinf(v)) else v
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    v = _safe_float(value)
    return int(v) if v is not None else None


def _deg(semicircles: float | None) -> float | None:
    """Convert FIT semicircle value to decimal degrees."""
    if semicircles is None:
        return None
    return semicircles * _SEMICIRCLE_TO_DEG


def parse_fit_file(file_bytes: bytes) -> dict:
    """Parse a FIT file from raw bytes.

    Returns::

        {
            "session": {
                "name": str,
                "sport_type": str,
                "start_time": datetime,
                "duration_seconds": int | None,
                "distance_meters": float | None,
                "elevation_gain_meters": float | None,
                "average_heartrate": float | None,
                "max_heartrate": float | None,
                "average_power": float | None,
                "normalized_power": float | None,
                "average_speed": float | None,
                "average_cadence": float | None,
                "calories": float | None,
                "record_count": int,
            },
            "streams": {
                "heartrate": [float | None, ...],
                "power": [float | None, ...],
                "cadence": [float | None, ...],
                "altitude": [float | None, ...],
                "enhanced_speed": [float | None, ...],
                "position_lat": [float, ...],   # decimal degrees
                "position_long": [float, ...],   # decimal degrees
                "temperature": [float | None, ...],
            }
        }

    Raises ValueError if the file cannot be parsed or contains no session data.
    """
    try:
        fitfile = FitFile(file_bytes)
    except Exception as e:
        raise ValueError(f"Invalid FIT file: {e}") from e

    # ── Extract session message ────────────────────────────────────────────
    session_data: dict[str, Any] = {}
    for msg in fitfile.get_messages("session"):
        for field in msg.fields:
            session_data[field.name] = field.value

    if not session_data:
        raise ValueError("FIT file contains no session data")

    # Determine sport type
    sport_enum = session_data.get("sport")
    if isinstance(sport_enum, int):
        sport_type = _SPORT_MAP.get(sport_enum, "cycling")
    else:
        sport_raw = str(sport_enum).lower() if sport_enum else ""
        sport_type = _SPORT_MAP.get(sport_raw, sport_raw or "cycling")

    # Build activity name
    start_time = session_data.get("start_time")
    if isinstance(start_time, datetime):
        ts_label = start_time.strftime("%Y-%m-%d %H:%M")
    else:
        ts_label = "Activity"
    name = f"{sport_type.capitalize()} — {ts_label}"

    # Duration: prefer total_elapsed_time, fall back to total_timer_time
    duration = _safe_int(session_data.get("total_elapsed_time") or session_data.get("total_timer_time"))

    # Distance
    distance = _safe_float(session_data.get("total_distance"))

    # Elevation gain
    elev_gain = _safe_float(session_data.get("total_ascent"))

    # Speed: FIT stores m/s
    avg_speed = _safe_float(session_data.get("enhanced_avg_speed") or session_data.get("avg_speed"))

    session_info = {
        "name": name,
        "sport_type": sport_type,
        "start_time": start_time if isinstance(start_time, datetime) else datetime.now(timezone.utc),
        "duration_seconds": duration,
        "distance_meters": distance,
        "elevation_gain_meters": elev_gain,
        "average_heartrate": _safe_float(session_data.get("avg_heart_rate")),
        "max_heartrate": _safe_float(session_data.get("max_heart_rate")),
        "average_power": _safe_float(session_data.get("avg_power")),
        "normalized_power": _safe_float(session_data.get("normalized_power_power") or session_data.get("normalized_power")),
        "average_speed": avg_speed,
        "average_cadence": _safe_float(session_data.get("avg_cadence")),
        "calories": _safe_float(session_data.get("total_calories")),
        "record_count": 0,
    }

    # ── Extract record messages (time-series) ──────────────────────────────
    streams: dict[str, list] = {
        "heartrate": [],
        "power": [],
        "cadence": [],
        "altitude": [],
        "enhanced_speed": [],
        "position_lat": [],
        "position_long": [],
        "temperature": [],
    }
    record_count = 0

    for msg in fitfile.get_messages("record"):
        record_count += 1
        fields = {f.name: f.value for f in msg.fields}

        streams["heartrate"].append(_safe_float(fields.get("heart_rate")))
        streams["power"].append(_safe_float(fields.get("power")))
        streams["cadence"].append(_safe_float(fields.get("cadence")))
        streams["altitude"].append(
            _safe_float(fields.get("enhanced_altitude") or fields.get("altitude"))
        )
        streams["enhanced_speed"].append(
            _safe_float(fields.get("enhanced_speed") or fields.get("speed"))
        )

        lat = _deg(fields.get("position_lat"))
        lng = _deg(fields.get("position_long"))
        streams["position_lat"].append(lat)
        streams["position_long"].append(lng)
        streams["temperature"].append(_safe_float(fields.get("temperature")))

    session_info["record_count"] = record_count

    # Drop streams that are entirely None (no data for that field)
    pruned_streams = {
        k: v for k, v in streams.items() if any(x is not None for x in v)
    }

    # Also drop GPS coordinates entirely None
    if not pruned_streams.get("position_lat") or not pruned_streams.get("position_long"):
        pruned_streams.pop("position_lat", None)
        pruned_streams.pop("position_long", None)

    return {
        "session": session_info,
        "streams": pruned_streams,
    }
