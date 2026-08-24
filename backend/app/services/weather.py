"""Weather service — Open-Meteo integration with DB-backed response caching.

Open-Meteo is free and requires no API key. All external responses are
normalized before storage so the cached JSON is exactly what the API returns.
"""

import logging
from datetime import UTC, date, datetime, timedelta

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity
from app.models.cycling import CyclingProfile
from app.models.weather import CachedWeather

logger = logging.getLogger(__name__)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

# Archive data lags ~5 days — for dates within the last week use the
# forecast endpoint's past_days window instead.
ARCHIVE_LAG_DAYS = 7

_CURRENT_PARAMS = (
    "temperature_2m,relative_humidity_2m,apparent_temperature,"
    "precipitation,weather_code,wind_speed_10m,wind_direction_10m"
)
_DAILY_PARAMS = (
    "weather_code,temperature_2m_max,temperature_2m_min,"
    "precipitation_sum,precipitation_probability_max,wind_speed_10m_max"
)

_CACHE_TTL = {
    "current": timedelta(hours=1),
    "forecast": timedelta(hours=6),
    "historical": None,  # never expires
}


# ── Pure helpers ─────────────────────────────────────────────────────────────


def _wmo_code_to_conditions(code: int) -> str:
    """Map a WMO weather code to a human-readable condition string."""
    mapping = {
        0: "Clear",
        1: "Partly Cloudy",
        2: "Partly Cloudy",
        3: "Partly Cloudy",
        45: "Fog",
        48: "Fog",
        51: "Drizzle",
        53: "Drizzle",
        55: "Drizzle",
        56: "Freezing Drizzle",
        57: "Freezing Drizzle",
        61: "Rain",
        63: "Rain",
        65: "Rain",
        66: "Freezing Rain",
        67: "Freezing Rain",
        71: "Snow",
        73: "Snow",
        75: "Snow",
        77: "Snow Grains",
        80: "Rain Showers",
        81: "Rain Showers",
        82: "Rain Showers",
        85: "Snow Showers",
        86: "Snow Showers",
        95: "Thunderstorm",
        96: "Thunderstorm w/ Hail",
        99: "Thunderstorm w/ Hail",
    }
    return mapping.get(code, "Unknown")


def degrees_to_compass(degrees: float | None) -> str | None:
    """Convert wind direction in degrees to an 8-point compass string."""
    if degrees is None:
        return None
    dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return dirs[round(degrees / 45) % 8]


_BAD_CONDITIONS = {
    "Rain",
    "Freezing Rain",
    "Freezing Drizzle",
    "Drizzle",
    "Rain Showers",
    "Snow",
    "Snow Showers",
    "Snow Grains",
    "Thunderstorm",
    "Thunderstorm w/ Hail",
}


def is_bad_weather(daily: dict) -> dict | None:
    """Check whether a normalized day is bad riding weather.

    ``daily`` uses the ForecastDay field names (temp_min, temp_max,
    wind_speed_max, precipitation_probability_max, precipitation_sum,
    conditions). Returns {"reason", "level"} or None.
    """
    temp_min = daily.get("temp_min")
    temp_max = daily.get("temp_max")
    wind = daily.get("wind_speed_max")
    precip_prob = daily.get("precipitation_probability_max") or daily.get(
        "precipitation_probability"
    )
    precip_sum = daily.get("precipitation_sum")
    conditions = daily.get("conditions")

    if (temp_min is not None and temp_min < 5) or (
        temp_max is not None and temp_max > 32
    ):
        return {"reason": "extreme temperature", "level": "warning"}

    if wind is not None and wind > 60:
        return {"reason": "strong wind", "level": "danger"}
    if wind is not None and wind > 40:
        return {"reason": "strong wind", "level": "warning"}

    if (precip_prob is not None and precip_prob > 50) or (
        precip_sum is not None and precip_sum > 2
    ):
        return {"reason": "rain likely", "level": "warning"}

    if conditions in _BAD_CONDITIONS:
        return {"reason": conditions.lower(), "level": "warning"}

    return None


def cache_coords(lat: float, lng: float) -> tuple[float, float]:
    """Round coordinates for the cache key (~1km grid)."""
    return round(lat, 2), round(lng, 2)


# ── Cache helpers ────────────────────────────────────────────────────────────


async def _get_cached(
    db: AsyncSession, user_id, weather_type: str, lat: float, lng: float
) -> dict | None:
    rlat, rlng = cache_coords(lat, lng)
    now = datetime.now(UTC)
    result = await db.execute(
        select(CachedWeather)
        .where(
            CachedWeather.user_id == user_id,
            CachedWeather.weather_type == weather_type,
            CachedWeather.latitude == rlat,
            CachedWeather.longitude == rlng,
            or_(
                CachedWeather.expires_at.is_(None),
                CachedWeather.expires_at > now,
            ),
        )
        .order_by(CachedWeather.cached_at.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    return row.weather_data if row else None


async def _store_cache(
    db: AsyncSession,
    user_id,
    weather_type: str,
    lat: float,
    lng: float,
    data: dict,
) -> None:
    """Upsert the cache: delete any stale rows for this key, then insert."""
    rlat, rlng = cache_coords(lat, lng)
    result = await db.execute(
        select(CachedWeather).where(
            CachedWeather.user_id == user_id,
            CachedWeather.weather_type == weather_type,
            CachedWeather.latitude == rlat,
            CachedWeather.longitude == rlng,
        )
    )
    for stale in result.scalars().all():
        await db.delete(stale)

    ttl = _CACHE_TTL[weather_type]
    db.add(
        CachedWeather(
            user_id=user_id,
            latitude=rlat,
            longitude=rlng,
            weather_type=weather_type,
            weather_data=data,
            expires_at=(datetime.now(UTC) + ttl) if ttl else None,
        )
    )
    await db.flush()


# ── HTTP client ──────────────────────────────────────────────────────────────


async def _fetch(url: str, params: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as e:
        logger.warning("Open-Meteo request failed (%s): %s", url, e)
        raise ValueError("Weather service unavailable") from e


# ── Coordinate resolution ────────────────────────────────────────────────────


async def resolve_user_coords(db: AsyncSession, user_id) -> tuple[float, float] | None:
    """Best-effort home location for a user.

    Priority: CyclingProfile.home_lat/home_lng → most recent cycling
    activity's linked route start coords → raw_data["start_latlng"].
    """
    result = await db.execute(
        select(CyclingProfile.home_lat, CyclingProfile.home_lng).where(
            CyclingProfile.user_id == user_id
        )
    )
    row = result.one_or_none()
    if row and row.home_lat is not None and row.home_lng is not None:
        return (float(row.home_lat), float(row.home_lng))

    # Most recent cycling activity with a linked route
    result = await db.execute(
        select(Activity.route_id)
        .where(
            Activity.user_id == user_id,
            Activity.sport_type == "cycling",
            Activity.route_id.isnot(None),
        )
        .order_by(Activity.start_date.desc())
        .limit(1)
    )
    route_id = result.scalar_one_or_none()
    if route_id:
        from app.models.route import Route

        result = await db.execute(
            select(Route.start_lat, Route.start_lng).where(Route.id == route_id)
        )
        coords = result.one_or_none()
        if coords:
            return (float(coords.start_lat), float(coords.start_lng))

    # Fall back to raw provider payload on the most recent cycling activity
    result = await db.execute(
        select(Activity.raw_data)
        .where(
            Activity.user_id == user_id,
            Activity.sport_type == "cycling",
            Activity.raw_data.isnot(None),
        )
        .order_by(Activity.start_date.desc())
        .limit(1)
    )
    raw = result.scalar_one_or_none()
    if isinstance(raw, dict):
        start = raw.get("start_latlng")
        if (
            isinstance(start, (list, tuple))
            and len(start) >= 2
            and start[0] is not None
            and start[1] is not None
        ):
            return (float(start[0]), float(start[1]))

    return None


def resolve_activity_coords(
    activity: Activity,
    route_start_lat: float | None = None,
    route_start_lng: float | None = None,
) -> tuple[float, float] | None:
    """Activity location from its route relationship or raw_data fallback."""
    route = getattr(activity, "route", None)
    lat = route_start_lat
    lng = route_start_lng
    if route is not None:
        lat = route.start_lat
        lng = route.start_lng
    if lat is not None and lng is not None:
        return (float(lat), float(lng))

    raw = activity.raw_data or {}
    start = raw.get("start_latlng")
    if (
        isinstance(start, (list, tuple))
        and len(start) >= 2
        and start[0] is not None
        and start[1] is not None
    ):
        return (float(start[0]), float(start[1]))

    return None


# ── Normalizers ──────────────────────────────────────────────────────────────


def _normalize_current(payload: dict, lat: float, lng: float) -> dict:
    current = payload.get("current", {}) if isinstance(payload, dict) else {}
    return {
        "temperature": current.get("temperature_2m"),
        "apparent_temperature": current.get("apparent_temperature"),
        "humidity": current.get("relative_humidity_2m"),
        "precipitation_mm": current.get("precipitation"),
        "wind_speed_kmh": current.get("wind_speed_10m"),
        "wind_direction": degrees_to_compass(current.get("wind_direction_10m")),
        "conditions": _wmo_code_to_conditions(current.get("weather_code") or 0)
        if current.get("weather_code") is not None
        else None,
        "latitude": lat,
        "longitude": lng,
    }


def _normalize_daily(payload: dict, lat: float, lng: float) -> dict:
    daily = payload.get("daily", {}) if isinstance(payload, dict) else {}
    dates = daily.get("time") or []
    codes = daily.get("weather_code") or []
    tmax = daily.get("temperature_2m_max") or []
    tmin = daily.get("temperature_2m_min") or []
    pprob = daily.get("precipitation_probability_max") or []
    psum = daily.get("precipitation_sum") or []
    wmax = daily.get("wind_speed_10m_max") or []

    def _at(arr, i):
        return arr[i] if i < len(arr) else None

    days = []
    for i, d in enumerate(dates):
        code = _at(codes, i)
        days.append(
            {
                "date": d,
                "weather_code": code,
                "conditions": _wmo_code_to_conditions(code)
                if code is not None
                else None,
                "temp_max": _at(tmax, i),
                "temp_min": _at(tmin, i),
                "precipitation_probability": _at(pprob, i),
                "precipitation_sum": _at(psum, i),
                "wind_speed_max": _at(wmax, i),
            }
        )
    return {"latitude": lat, "longitude": lng, "days": days}


# ── Cached fetches ───────────────────────────────────────────────────────────


async def get_current(db: AsyncSession, user_id, lat: float, lng: float) -> dict:
    """Current conditions for a coordinate (cached 1 hour)."""
    cached = await _get_cached(db, user_id, "current", lat, lng)
    if cached is not None:
        return cached

    payload = await _fetch(FORECAST_URL, {"current": _CURRENT_PARAMS})
    data = _normalize_current(payload, round(lat, 2), round(lng, 2))
    await _store_cache(db, user_id, "current", lat, lng, data)
    return data


async def get_forecast(
    db: AsyncSession, user_id, lat: float, lng: float, days: int = 7
) -> dict:
    """Daily forecast for a coordinate (cached 6 hours)."""
    days = max(1, min(days, 7))
    cached = await _get_cached(db, user_id, "forecast", lat, lng)
    if cached is not None and len(cached.get("days", [])) >= days:
        sliced = {**cached, "days": cached["days"][:days]}
        return sliced

    payload = await _fetch(
        FORECAST_URL, {"daily": _DAILY_PARAMS, "forecast_days": days}
    )
    data = _normalize_daily(payload, round(lat, 2), round(lng, 2))
    await _store_cache(db, user_id, "forecast", lat, lng, data)
    return data


async def get_historical(
    db: AsyncSession,
    user_id,
    lat: float,
    lng: float,
    start_date: date,
    end_date: date,
) -> dict:
    """Historical daily weather for a coordinate (cached indefinitely)."""
    cached = await _get_cached(db, user_id, "historical", lat, lng)
    if (
        cached is not None
        and cached.get("start_date") == start_date.isoformat()
        and cached.get("end_date") == end_date.isoformat()
    ):
        return {k: v for k, v in cached.items() if k not in ("start_date", "end_date")}

    today = datetime.now(UTC).date()
    data: dict
    if end_date >= today - timedelta(days=ARCHIVE_LAG_DAYS):
        # Archive lags ~5 days — use the forecast endpoint's past window
        payload = await _fetch(
            FORECAST_URL, {"daily": _DAILY_PARAMS, "past_days": ARCHIVE_LAG_DAYS}
        )
        full = _normalize_daily(payload, round(lat, 2), round(lng, 2))
        data = {
            **full,
            "days": [
                d
                for d in full["days"]
                if start_date.isoformat() <= d["date"] <= end_date.isoformat()
            ],
        }
    else:
        payload = await _fetch(
            ARCHIVE_URL,
            {
                "daily": _DAILY_PARAMS,
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
            },
        )
        data = _normalize_daily(payload, round(lat, 2), round(lng, 2))

    store = {
        **data,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
    }
    await _store_cache(db, user_id, "historical", lat, lng, store)
    return data


# ── Activity tagging ─────────────────────────────────────────────────────────


async def tag_activity(db: AsyncSession, user_id, activity_id) -> dict | None:
    """Backfill the weather_* columns for one activity from historical data.

    Returns a summary dict, or None when the activity has no resolvable
    coordinates (or no weather data was available for its date).
    """
    result = await db.execute(
        select(Activity)
        .options(selectinload(Activity.route))
        .where(Activity.id == activity_id, Activity.user_id == user_id)
    )
    activity = result.scalar_one_or_none()
    if not activity:
        return None

    coords = resolve_activity_coords(activity)
    if coords is None:
        return None
    lat, lng = coords

    day = activity.start_date.date()
    historical = await get_historical(db, user_id, lat, lng, day, day)
    days = historical.get("days", [])
    if not days:
        return None
    d = days[0]

    activity.weather_temperature = d.get("temp_max")
    activity.weather_conditions = d.get("conditions")
    activity.weather_wind_speed_kmh = d.get("wind_speed_max")
    activity.weather_wind_direction = None  # direction only in current endpoint
    activity.weather_precipitation_mm = d.get("precipitation_sum")

    await db.flush()

    return {
        "activity_id": str(activity.id),
        "temperature": activity.weather_temperature,
        "conditions": activity.weather_conditions,
        "wind_speed_kmh": activity.weather_wind_speed_kmh,
        "wind_direction": activity.weather_wind_direction,
        "precipitation_mm": activity.weather_precipitation_mm,
    }


async def tag_recent_activities(db: AsyncSession, user_id, limit: int = 50) -> int:
    """Tag cycling activities from the last 30 days missing weather data."""
    cutoff = datetime.now(UTC) - timedelta(days=30)
    result = await db.execute(
        select(Activity.id)
        .where(
            Activity.user_id == user_id,
            Activity.sport_type == "cycling",
            Activity.start_date >= cutoff,
            Activity.weather_temperature.is_(None),
        )
        .order_by(Activity.start_date.desc())
        .limit(limit)
    )
    ids = list(result.scalars().all())

    tagged = 0
    for activity_id in ids:
        try:
            summary = await tag_activity(db, user_id, activity_id)
            if summary is not None:
                tagged += 1
        except ValueError as e:
            logger.warning(
                "Weather tagging skipped for activity %s: %s", activity_id, e
            )
        except Exception as e:
            logger.warning("Weather tagging failed for activity %s: %s", activity_id, e)
    return tagged
