"""Notifications API — list/read in-app notifications and per-user preferences."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import (
    NotificationPreferences,
    NotificationPreferencesUpdate,
    NotificationRead,
    NotificationSummary,
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
    offset: int = Query(0, ge=0),
    unread_only: bool = Query(False),
    read: bool | None = Query(None, description="Filter by read state"),
    type: str | None = Query(
        None, description="Filter by a single notification type (e.g. `pr`)"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List notifications newest-first.

    ``offset`` pages through history beyond ``limit``; ``type`` and ``read``
    narrow server-side so filtering isn't limited to the newest page (which is
    what a client-side filter over a 200-row cap effectively does). See
    ``GET /summary`` for the counts that drive the filter chips.
    """
    query = select(Notification).where(Notification.user_id == current_user.id)
    if unread_only:
        query = query.where(Notification.read.is_(False))
    if read is not None:
        query = query.where(Notification.read.is_(read))
    if type:
        query = query.where(Notification.type == type)
    query = (
        query.order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/summary", response_model=NotificationSummary)
async def notification_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Total / unread counts and a per-type breakdown for the whole history.

    Lets the UI label its filter chips and unread badge from the database
    instead of from whatever slice of rows it happens to have loaded.
    """
    result = await db.execute(
        select(Notification.type, Notification.read, func.count())
        .where(Notification.user_id == current_user.id)
        .group_by(Notification.type, Notification.read)
    )
    by_type: dict[str, int] = {}
    total = 0
    unread = 0
    for notif_type, is_read, count in result.all():
        by_type[notif_type] = by_type.get(notif_type, 0) + count
        total += count
        if not is_read:
            unread += count
    return NotificationSummary(total=total, unread=unread, by_type=by_type)


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