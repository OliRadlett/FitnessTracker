"""Notifications API — list/read in-app notifications and per-user preferences."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import (
    NotificationPreferences,
    NotificationPreferencesUpdate,
    NotificationRead,
)
from app.services.auth import get_current_user
from app.services.notifications import (
    get_notification_preferences,
    set_notification_preferences,
)

router = APIRouter()


@router.get("", response_model=list[NotificationRead])
async def list_notifications(
    limit: int = Query(50, ge=1, le=200),
    unread_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List notifications newest-first, optionally unread only."""
    query = select(Notification).where(Notification.user_id == current_user.id)
    if unread_only:
        query = query.where(Notification.read.is_(False))
    query = query.order_by(Notification.created_at.desc()).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


@router.patch("/{notification_id}/read", response_model=NotificationRead)
async def mark_notification_read(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a single notification as read."""
    from datetime import UTC, datetime

    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )
    notification = result.scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    notification.read = True
    notification.read_at = datetime.now(UTC)
    await db.flush()
    return notification


@router.post("/read-all")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark all notifications for the current user as read."""
    from datetime import UTC, datetime

    result = await db.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.read.is_(False),
        )
    )
    notifications = list(result.scalars().all())
    now = datetime.now(UTC)
    for n in notifications:
        n.read = True
        n.read_at = now
    await db.flush()
    return {"marked": len(notifications)}


@router.get("/preferences", response_model=NotificationPreferences)
async def get_preferences(
    current_user: User = Depends(get_current_user),
):
    """Get the current user's per-type notification toggles."""
    return get_notification_preferences(current_user)


@router.patch("/preferences", response_model=NotificationPreferences)
async def update_preferences(
    payload: NotificationPreferencesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update per-type notification toggles (partial update supported)."""
    return await set_notification_preferences(
        db,
        current_user,
        payload.model_dump(exclude_unset=True),
    )