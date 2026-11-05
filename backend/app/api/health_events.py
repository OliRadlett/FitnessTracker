"""Health-event API — user-marked illness/injury/fatigue periods."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.health_event import (
    HealthEventCreate,
    HealthEventRead,
    HealthEventUpdate,
    HealthEventValidation,
)
from app.services.auth import get_current_user
from app.services.health_events import (
    create_health_event,
    delete_health_event,
    list_health_events,
    update_health_event,
    validate_health_alerts,
)

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/health-events", response_model=list[HealthEventRead])
async def get_health_events(
    days: int = Query(365, ge=30, le=3650),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List the user's marked health periods (most recent first)."""
    return await list_health_events(db, current_user.id, days)


@router.post(
    "/health-events",
    response_model=HealthEventRead,
    status_code=status.HTTP_201_CREATED,
)
async def post_health_event(
    payload: HealthEventCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark an illness/injury/fatigue period."""
    return await create_health_event(db, current_user.id, payload)


@router.get("/health-events/validation", response_model=HealthEventValidation)
async def get_health_event_validation(
    days: int = Query(365, ge=30, le=3650),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """How many persisted alerts overlap the user's marked periods."""
    return await validate_health_alerts(db, current_user.id, days)


@router.patch("/health-events/{event_id}", response_model=HealthEventRead)
async def patch_health_event(
    event_id: uuid.UUID,
    payload: HealthEventUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Edit a marked period; omitted fields are unchanged."""
    try:
        event = await update_health_event(
            db, current_user.id, event_id, payload
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if event is None:
        raise HTTPException(status_code=404, detail="Health event not found")
    return event


@router.delete("/health-events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_health_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a marked period."""
    if not await delete_health_event(db, current_user.id, event_id):
        raise HTTPException(status_code=404, detail="Health event not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
