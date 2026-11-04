"""Normalized replay payload for the 3D viewer.

The standalone prototype consumes a `Ride` object with aligned streams,
bounds, camera key points and story highlights. This service builds the same
shape from an `Activity` + its `ActivityStream` rows, so the new viewer does
not have to duplicate the normalization or the stream-spelling matrix.

Pure-ish: it only reads the loaded activity and its streams. The API endpoint
is responsible for eager-loading `streams`, `sources` and `route`.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime
from typing import Any

from app.models.activity import Activity, ActivityStream
from app.services.polyline_utils import (
    decode_polyline,
    extract_activity_polyline,
    haversine_distance,
)

MAX_SAMPLES = 5000
CLIMB_WINDOW_M = 500.0
FASTEST_WINDOW_M = 1000.0

VELOCITY_TYPES = ("velocity_smooth", "velocity", "enhanced_speed")
ALTITUDE_TYPES = ("altitude",)
HEART_RATE_TYPES = ("heartrate", "hr", "heart_rate")
POWER_TYPES = ("watts", "power")
CADENCE_TYPES = ("cadence",)
TIME_TYPES = ("time",)
DISTANCE_TYPES = ("distance",)
LATLNG_TYPES = ("latlng",)


class ReplayUnavailable(ValueError):
    """The activity cannot produce a usable replay (no speed/GPS)."""


def _raw_values(
    streams: list[ActivityStream], types: tuple[str, ...]
) -> tuple[list[Any], int | None]:
    for stream_type in types:
        for stream in streams:
            if stream.stream_type != stream_type:
                continue
            data = stream.data.get("data") if isinstance(stream.data, dict) else stream.data
            if isinstance(data, list) and data:
                return data, stream.resolution
    return [], None


def _numeric_values(
    streams: list[ActivityStream], types: tuple[str, ...]
) -> tuple[list[float], int | None]:
    raw, resolution = _raw_values(streams, types)
    values: list[float] = []
    for value in raw:
        try:
            number = float(value)
        except (TypeError, ValueError):
            number = float("nan")
        values.append(number if math.isfinite(number) else 0.0)
    return values, resolution


def _resample(values: list[float], n: int) -> list[float]:
    """Linear resample to exactly n samples; empty -> zeros."""
    if n <= 0:
        return []
    if not values:
        return [0.0] * n
    if len(values) == n:
        return list(values)
    if len(values) == 1:
        return [values[0]] * n
    last = len(values) - 1
    out: list[float] = []
    for i in range(n):
        pos = (i * last) / (n - 1)
        left = int(math.floor(pos))
        right = min(last, left + 1)
        frac = pos - left
        out.append(values[left] * (1 - frac) + values[right] * frac)
    return out


def _resample_pairs(
    values: list[Any], n: int
) -> list[tuple[float, float]]:
    pairs: list[tuple[float, float]] = []
    for value in values:
        if isinstance(value, (list, tuple)) and len(value) >= 2:
            try:
                pairs.append((float(value[0]), float(value[1])))
            except (TypeError, ValueError):
                continue
    if not pairs:
        return []
    if len(pairs) == n:
        return pairs
    if len(pairs) == 1:
        return [pairs[0]] * n
    last = len(pairs) - 1
    out: list[tuple[float, float]] = []
    for i in range(n):
        pos = (i * last) / (n - 1)
        left = int(math.floor(pos))
        right = min(last, left + 1)
        frac = pos - left
        out.append(
            (
                pairs[left][0] * (1 - frac) + pairs[right][0] * frac,
                pairs[left][1] * (1 - frac) + pairs[right][1] * frac,
            )
        )
    return out


def _resolution(
    velocity_resolution: int | None,
    time_values: list[float],
    default: float = 1.0,
) -> float:
    if velocity_resolution and velocity_resolution > 0:
        return float(velocity_resolution)
    if len(time_values) >= 2:
        deltas = [
            time_values[i] - time_values[i - 1]
            for i in range(1, len(time_values))
            if time_values[i] > time_values[i - 1]
        ]
        if deltas:
            return sum(deltas) / len(deltas)
    return default


def _cumulative_distance(
    velocity: list[float], time_values: list[float], resolution: float
) -> list[float]:
    out = [0.0]
    for i in range(1, len(velocity)):
        dt = time_values[i] - time_values[i - 1]
        if not (dt > 0):
            dt = resolution
        out.append(out[-1] + max(0.0, velocity[i]) * dt)
    return out


def _monotonic(values: list[float], step: float) -> list[float]:
    out = list(values)
    for i in range(1, len(out)):
        if not (out[i] > out[i - 1]):
            out[i] = out[i - 1] + step
    return out


def _interpolate_polyline(
    polyline: str, distances: list[float]
) -> list[tuple[float, float]]:
    points = decode_polyline(polyline)
    if len(points) < 2:
        return []
    cumulative = [0.0]
    for i in range(1, len(points)):
        cumulative.append(
            cumulative[-1]
            + haversine_distance(
                points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]
            )
        )
    total = cumulative[-1]
    if total <= 0:
        return [points[0]] * len(distances)
    out: list[tuple[float, float]] = []
    index = 1
    for target in distances:
        target = max(0.0, min(total, target))
        while index < len(cumulative) and cumulative[index] < target:
            index += 1
        if index >= len(cumulative):
            out.append(points[-1])
            continue
        span = cumulative[index] - cumulative[index - 1]
        frac = 0.0 if span <= 0 else (target - cumulative[index - 1]) / span
        frac = max(0.0, min(1.0, frac))
        out.append(
            (
                points[index - 1][0] + frac * (points[index][0] - points[index - 1][0]),
                points[index - 1][1] + frac * (points[index][1] - points[index - 1][1]),
            )
        )
    return out


def _grade(altitude: list[float], distance: list[float]) -> list[float]:
    n = len(altitude)
    if n < 2:
        return [0.0] * n
    raw = [0.0] * n
    for i in range(1, n - 1):
        span = distance[i + 1] - distance[i - 1]
        raw[i] = (
            ((altitude[i + 1] - altitude[i - 1]) / span) * 100.0 if span > 0 else 0.0
        )
    if n >= 2:
        raw[0] = raw[1]
        raw[-1] = raw[-2]
    window = min(9, n if n % 2 else n - 1)
    if window < 3:
        return [round(value, 2) for value in raw]
    half = window // 2
    smoothed: list[float] = []
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        segment = raw[lo:hi]
        smoothed.append(sum(segment) / len(segment) if segment else 0.0)
    return [round(value, 2) for value in smoothed]


def _decimate_indices(n: int, max_samples: int) -> list[int]:
    if n <= max_samples:
        return list(range(n))
    indices = [round(i * (n - 1) / (max_samples - 1)) for i in range(max_samples)]
    unique: list[int] = []
    for index in indices:
        if not unique or index != unique[-1]:
            unique.append(index)
    return unique


def _nearest(values: list[float], target: float) -> int:
    if not values:
        return 0
    return min(range(len(values)), key=lambda i: abs(values[i] - target))


def _window_stat(
    distance: list[float], values: list[float], window_m: float, maximum: bool
) -> tuple[int, int, float]:
    n = len(distance)
    if n < 2:
        return 0, n - 1, values[0] if values else 0.0
    best = (0, 0, -math.inf if maximum else math.inf)
    right = 0
    for left in range(n):
        while right < n and distance[right] - distance[left] < window_m:
            right += 1
        if right >= n:
            break
        segment = values[left : right + 1]
        value = max(segment) if maximum else min(segment)
        if (maximum and value > best[2]) or (not maximum and value < best[2]):
            best = (left, right, value)
    if best[1] == 0 and best[0] == 0 and not math.isfinite(best[2]):
        return 0, n - 1, values[0] if values else 0.0
    return best


def _fastest_km(
    distance: list[float], time_values: list[float], velocity: list[float]
) -> tuple[int, int, float]:
    n = len(distance)
    if n < 2:
        return 0, n - 1, 0.0
    best = (0, n - 1, 0.0)
    right = 0
    for left in range(n):
        while right < n and distance[right] - distance[left] < FASTEST_WINDOW_M:
            right += 1
        if right >= n:
            break
        elapsed = time_values[right] - time_values[left]
        if elapsed <= 0:
            continue
        speed = (distance[right] - distance[left]) / elapsed
        if speed > best[2]:
            best = (left, right, speed)
    if best[2] <= 0:
        index = max(range(n), key=lambda i: velocity[i])
        return index, min(n - 1, index + 1), velocity[index]
    return best


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _ascent_descent(altitude: list[float]) -> tuple[float, float]:
    ascent = 0.0
    descent = 0.0
    for i in range(1, len(altitude)):
        delta = altitude[i] - altitude[i - 1]
        if delta > 0:
            ascent += delta
        else:
            descent -= delta
    return ascent, descent


def _route_name(activity: Activity) -> str | None:
    route = getattr(activity, "route", None)
    return getattr(route, "name", None) if route is not None else None


def activity_timezone(activity: Activity) -> str:
    """The activity's IANA timezone from the provider payload, or UTC.

    ``Activity`` has no timezone column; Strava's ``raw_data`` carries it, and
    callers that only need to render a date (the ghost picker) need the same
    answer as the replay does.
    """
    raw = activity.raw_data or {}
    return str(raw.get("timezone") or "UTC")


def _build_streams(
    activity: Activity,
) -> tuple[dict[str, Any], str | None]:
    streams = list(getattr(activity, "streams", None) or [])
    velocity, velocity_resolution = _numeric_values(streams, VELOCITY_TYPES)
    if len(velocity) < 2:
        raise ReplayUnavailable("Activity has no speed stream for a 3D replay")

    raw_time, _ = _numeric_values(streams, TIME_TYPES)
    resolution = _resolution(velocity_resolution, raw_time)
    n = len(velocity)

    if raw_time:
        time_values = _resample(raw_time, n)
        first = time_values[0]
        time_values = [value - first for value in time_values]
        time_values = _monotonic(time_values, resolution)
    else:
        time_values = [i * resolution for i in range(n)]

    raw_distance, _ = _numeric_values(streams, DISTANCE_TYPES)
    if raw_distance:
        distance = _resample(raw_distance, n)
        if distance[-1] <= 0:
            distance = _cumulative_distance(velocity, time_values, resolution)
    else:
        distance = _cumulative_distance(velocity, time_values, resolution)
    distance = _monotonic(distance, 0.0)

    altitude = _resample(
        _numeric_values(streams, ALTITUDE_TYPES)[0], n
    )
    heart_rate = _resample(
        _numeric_values(streams, HEART_RATE_TYPES)[0], n
    )
    power = _resample(_numeric_values(streams, POWER_TYPES)[0], n)
    cadence = _resample(_numeric_values(streams, CADENCE_TYPES)[0], n)

    polyline = extract_activity_polyline(activity)
    raw_latlng, _ = _raw_values(streams, LATLNG_TYPES)
    if raw_latlng:
        latlng = _resample_pairs(raw_latlng, n)
    elif polyline:
        latlng = _interpolate_polyline(polyline, distance)
    else:
        raise ReplayUnavailable("Activity has no GPS route for a 3D replay")
    if len(latlng) != n:
        raise ReplayUnavailable("Activity GPS stream could not be aligned")

    indices = _decimate_indices(n, MAX_SAMPLES)
    time_values = [time_values[i] for i in indices]
    distance = [distance[i] for i in indices]
    altitude = [altitude[i] for i in indices]
    heart_rate = [heart_rate[i] for i in indices]
    power = [power[i] for i in indices]
    cadence = [cadence[i] for i in indices]
    velocity = [velocity[i] for i in indices]
    latlng = [latlng[i] for i in indices]
    grade = _grade(altitude, distance)

    streams_out = {
        "t": [round(value, 1) for value in time_values],
        "d": [round(value, 1) for value in distance],
        "lat": [round(point[0], 5) for point in latlng],
        "lng": [round(point[1], 5) for point in latlng],
        "alt": [round(value, 1) for value in altitude],
        "v": [round(value, 2) for value in velocity],
        "hr": [int(round(value)) for value in heart_rate],
        "grade": grade,
    }
    if any(value != 0 for value in power):
        streams_out["watts"] = [int(round(value)) for value in power]
    if any(value != 0 for value in cadence):
        streams_out["cadence"] = [int(round(value)) for value in cadence]

    return streams_out, polyline


def build_replay(activity: Activity) -> dict[str, Any]:
    """Build the normalized replay payload for one activity."""
    streams, polyline = _build_streams(activity)
    n = len(streams["t"])
    if n < 2:
        raise ReplayUnavailable("Activity has too few samples for a 3D replay")

    t = [float(value) for value in streams["t"]]
    d = [float(value) for value in streams["d"]]
    alt = [float(value) for value in streams["alt"]]
    v = [float(value) for value in streams["v"]]
    hr = [float(value) for value in streams["hr"]]
    lat = [float(value) for value in streams["lat"]]
    lng = [float(value) for value in streams["lng"]]
    grade = [float(value) for value in streams["grade"]]
    power = [float(value) for value in streams.get("watts", [])]
    ascent, descent = _ascent_descent(alt)
    route_name = _route_name(activity)
    pose_labels = (
        {"lausanne": "Start", "montreux": "Mid"}
        if route_name and "arthur" in route_name.lower()
        else None
    )
    moving_s = int(activity.duration_seconds or t[-1])
    distance_m = float(activity.distance_meters or d[-1])
    elapsed_s = float(t[-1])
    avg_speed = float(
        activity.average_speed or (distance_m / moving_s if moving_s > 0 else 0.0)
    )
    avg_hr = float(activity.average_heartrate or _mean(hr))
    avg_power = (
        float(activity.average_power)
        if activity.average_power is not None
        else (float(_mean(power)) if power else None)
    )
    pause_s = 0.0
    pause_count = 0
    for i in range(1, n):
        delta = t[i] - t[i - 1]
        if delta > 60 and v[i] < 0.5:
            pause_s += delta
            pause_count += 1

    climb_left, climb_right, climb_grade = _window_stat(
        d, grade, CLIMB_WINDOW_M, maximum=True
    )
    descent_left, descent_right, descent_grade = _window_stat(
        d, grade, CLIMB_WINDOW_M, maximum=False
    )
    fastest_left, fastest_right, fastest_speed = _fastest_km(d, t, v)
    highest = max(range(n), key=lambda i: alt[i])
    lowest = min(range(n), key=lambda i: alt[i])
    climb_key = climb_left
    key_points = {
        "start": 0,
        "lausanne": _nearest(d, d[-1] * 0.25),
        "montreux": _nearest(d, d[-1] * 0.5),
        "climb": climb_key,
        "summit": highest,
        "fastest": fastest_left,
        "close": climb_key,
        "end": n - 1,
    }

    climb_gain = alt[climb_right] - alt[climb_left]
    descent_drop = alt[descent_left] - alt[descent_right]
    highlights = {
        "climb": {
            "startIdx": climb_left,
            "endIdx": climb_right,
            "startD": round(d[climb_left], 1),
            "endD": round(d[climb_right], 1),
            "gainM": round(climb_gain, 1),
            "gradePct": round(climb_grade, 2),
            "place": route_name or "Climb",
        },
        "descent": {
            "startIdx": descent_left,
            "endIdx": descent_right,
            "startD": round(d[descent_left], 1),
            "endD": round(d[descent_right], 1),
            "dropM": round(descent_drop, 1),
            "gradePct": round(descent_grade, 2),
            "place": route_name or "Descent",
        },
        "fastestKm": {
            "startIdx": fastest_left,
            "endIdx": fastest_right,
            "startD": round(d[fastest_left], 1),
            "speedKmh": round(fastest_speed * 3.6, 1),
            "place": route_name or "Fastest km",
        },
        "highest": {
            "idx": highest,
            "altM": round(alt[highest], 1),
            "place": route_name or "High point",
        },
        "lowest": {
            "idx": lowest,
            "altM": round(alt[lowest], 1),
            "place": route_name or "Low point",
        },
    }

    route = getattr(activity, "route", None)
    route_payload = (
        {"id": str(route.id), "name": route.name} if route is not None else None
    )
    activity_payload = {
        "id": str(activity.id),
        "name": activity.name,
        "start_date": activity.start_date.isoformat(),
        "timezone": activity_timezone(activity),
        "sport_type": activity.sport_type,
        "source": activity.source,
        "route_id": str(activity.route_id) if activity.route_id else None,
    }
    ride_payload = {
        "id": str(activity.id),
        "activity_id": str(activity.id),
        "name": activity.name,
        "date": activity.start_date.isoformat(),
        "timezone": activity_timezone(activity),
        "pose_labels": pose_labels,
        "stats": {
            "distance_m": round(distance_m, 1),
            "moving_s": moving_s,
            "elapsed_s": round(elapsed_s, 1),
            "elevation_gain_m": round(
                float(activity.elevation_gain_meters or ascent), 1
            ),
            "ascent_m": round(ascent, 1),
            "descent_m": round(descent, 1),
            "avg_speed_mps": round(avg_speed, 2),
            "avg_hr": round(avg_hr, 1),
            "avg_power_w": round(avg_power, 1) if avg_power is not None else None,
            "calories": round(float(activity.calories or 0), 1),
            "pause_count": pause_count,
            "pause_s": round(pause_s, 1),
        },
        "weather": {
            "temperature_c": activity.weather_temperature,
            "conditions": activity.weather_conditions,
            "wind_speed_kmh": activity.weather_wind_speed_kmh,
            "wind_direction_deg": activity.weather_wind_direction_deg,
            "precipitation_mm": activity.weather_precipitation_mm,
        },
        "bounds": {
            "min_lat": round(min(lat), 5),
            "max_lat": round(max(lat), 5),
            "min_lng": round(min(lng), 5),
            "max_lng": round(max(lng), 5),
        },
        "streams": streams,
        "key_points": key_points,
        "highlights": highlights,
        "encoded_polyline": polyline,
    }
    return {
        "activity": activity_payload,
        "ride": ride_payload,
        "route": route_payload,
    }
