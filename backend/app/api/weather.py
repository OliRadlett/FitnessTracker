"""Weather API — current conditions, forecasts, history, activity tagging."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.user import User
from app.schemas.weather import (
    ActivityWeatherResponse,
    CurrentWeatherResponse,
    ForecastResponse,
    TagActivityResponse,
)
from app.services.auth import get_current_user
from app.services.weather import (
    get_current as fetch_current,
)
from app.services.weather import (
    get_forecast as fetch_forecast,
)
from app.services.weather import (
    get_historical as fetch_historical,
)
from app.services.weather import resolve_user_coords, tag_activity

router = APIRouter()


async def _resolve_or_404(
    db: AsyncSession, user: User, lat: float | None, lng: float | None
) -> tuple[float, float]:
    """Explicit coords, or fall back to the user's resolved home location."""
    if lat is not None and lng is not None:
        return (lat, lng)
    coords = await resolve_user_coords(db, user.id)
    if coords is None:
        raise HTTPException(status_code=404, detail="No location available")
    return coords


@router.get("/current", response_model=CurrentWeatherResponse)
async def get_current_weather(
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Current conditions. Omit lat/lng to use the user's home location."""
    lat_v, lng_v = await _resolve_or_404(db, current_user, lat, lng)
    try:
        data = await fetch_current(db, current_user.id, lat_v, lng_v)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)
        )
    return CurrentWeatherResponse(**data)


@router.get("/forecast", response_model=ForecastResponse)
async def get_weather_forecast(
    days: int = Query(7, ge=1, le=7),
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Daily forecast (1-7 days). Omit lat/lng to use the user's home location."""
    lat_v, lng_v = await _resolve_or_404(db, current_user, lat, lng)
    try:
        data = await fetch_forecast(db, current_user.id, lat_v, lng_v, days=days)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)
        )
    return ForecastResponse(**data)


@router.get("/historical", response_model=ForecastResponse)
async def get_historical_weather(
    start_date: date = Query(...),
    end_date: date = Query(...),
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Historical daily weather for a date range."""
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date")
    lat_v, lng_v = await _resolve_or_404(db, current_user, lat, lng)
    try:
        data = await fetch_historical(
            db, current_user.id, lat_v, lng_v, start_date, end_date
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)
        )
    return ForecastResponse(**data)


@router.post("/tag-activity/{activity_id}", response_model=TagActivityResponse)
async def tag_activity_with_weather(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Backfill stored weather columns for an activity from historical data."""
    exists = await db.execute(
        select(Activity.id).where(
            Activity.id == activity_id, Activity.user_id == current_user.id
        )
    )
    if exists.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Activity not found")

    try:
        summary = await tag_activity(db, current_user.id, activity_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)
        )

    if summary is None:
        return TagActivityResponse(tagged=False)

    return TagActivityResponse(
        tagged=True,
        weather=ActivityWeatherResponse(**summary),
    )


@router.get(
    "/for-activity/{activity_id}", response_model=ActivityWeatherResponse | None
)
async def get_weather_for_activity(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stored weather snapshot for an activity — no external calls.

    Returns null when the activity has no tagged weather.
    """
    result = await db.execute(
        select(Activity).where(
            Activity.id == activity_id, Activity.user_id == current_user.id
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    if activity.weather_temperature is None and activity.weather_conditions is None:
        return None

    return ActivityWeatherResponse(
        activity_id=activity.id,
        temperature=activity.weather_temperature,
        conditions=activity.weather_conditions,
        wind_speed_kmh=activity.weather_wind_speed_kmh,
        wind_direction=activity.weather_wind_direction,
        precipitation_mm=activity.weather_precipitation_mm,
    )
