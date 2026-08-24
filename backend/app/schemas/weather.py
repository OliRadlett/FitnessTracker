"""Weather-specific Pydantic schemas."""

import uuid

from pydantic import BaseModel


class CurrentWeatherResponse(BaseModel):
    """Normalized current conditions from Open-Meteo."""

    temperature: float | None = None
    apparent_temperature: float | None = None
    humidity: float | None = None
    precipitation_mm: float | None = None
    wind_speed_kmh: float | None = None
    wind_direction: str | None = None  # compass, e.g. "NW"
    conditions: str | None = None  # WMO-mapped, e.g. "Rain"
    latitude: float
    longitude: float


class ForecastDay(BaseModel):
    """A single day of forecast/historical weather."""

    date: str  # YYYY-MM-DD
    weather_code: int | None = None
    conditions: str | None = None
    temp_max: float | None = None
    temp_min: float | None = None
    precipitation_probability: int | None = None
    precipitation_sum: float | None = None
    wind_speed_max: float | None = None


class ForecastResponse(BaseModel):
    """Daily forecast or historical weather for a location."""

    latitude: float
    longitude: float
    days: list[ForecastDay]


class ActivityWeatherResponse(BaseModel):
    """Stored weather snapshot for a single activity (no external calls)."""

    activity_id: uuid.UUID
    temperature: float | None = None
    conditions: str | None = None
    wind_speed_kmh: float | None = None
    wind_direction: str | None = None
    precipitation_mm: float | None = None


class TagActivityResponse(BaseModel):
    """Result of tagging an activity with historical weather."""

    tagged: bool
    weather: ActivityWeatherResponse | None = None
