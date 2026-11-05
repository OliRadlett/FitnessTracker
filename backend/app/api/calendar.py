"""Calendar API — one bounded read for the month/agenda surface."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.calendar import CalendarResponse
from app.services import calendar as calendar_service
from app.services.auth import get_current_user

router = APIRouter()


@router.get("", response_model=CalendarResponse)
async def get_calendar(
    start: date = Query(..., description="Range start (inclusive, YYYY-MM-DD)"),
    end: date = Query(..., description="Range end (inclusive, YYYY-MM-DD)"),
    plan_id: uuid.UUID | None = Query(
        None, description="Plan to read; defaults to the active plan"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return one dense calendar range for the current user.

    The range is bounded to 62 days (a month grid plus a week either side).
    A goals/events/current-load failure degrades that section and is reported in
    ``unavailable``; it never fails the whole calendar.
    """
    try:
        return await calendar_service.get_calendar(
            db,
            current_user.id,
            start,
            end,
            plan_id=plan_id,
        )
    except ValueError as exc:
        detail = str(exc)
        code = 404 if "not found" in detail else 422
        raise HTTPException(status_code=code, detail=detail) from exc
