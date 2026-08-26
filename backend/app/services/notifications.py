"""Notification service — preference-gated, dedup-keyed in-app notifications."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import User

# Default enabled-state per type. A user's stored preferences are merged over
# these, so a NULL column (pre-migration or untouched) means "all on".
DEFAULT_PREFERENCES: dict[str, bool] = {
    "health_alert": True,
    "pr": True,
    "goal_milestone": True,
    "plan_reminder": True,
}


def get_notification_preferences(user: User) -> dict[str, bool]:
    """Return the effective per-type enabled flags for a user."""
    stored = user.notification_preferences or {}
    merged = {**DEFAULT_PREFERENCES, **stored}
    return {key: bool(merged.get(key, True)) for key in DEFAULT_PREFERENCES}


async def set_notification_preferences(
    db: AsyncSession,
    user: User,
    updates: dict[str, bool | None],
) -> dict[str, bool]:
    """Apply partial preference updates and return the effective flags."""
    stored = user.notification_preferences or {}
    for key in DEFAULT_PREFERENCES:
        if key in updates and updates[key] is not None:
            stored[key] = bool(updates[key])
    user.notification_preferences = stored
    await db.flush()
    return get_notification_preferences(user)


async def notify(
    db: AsyncSession,
    user_id: uuid.UUID,
    type: str,
    title: str,
    body: str,
    severity: str = "info",
    link: str = "",
    dedup_key: str | None = None,
    metadata: dict | None = None,
) -> Notification | None:
    """Create an in-app notification if the type is enabled and not a duplicate.

    Returns the created ``Notification``, or ``None`` when gated by the user's
    preferences or deduped. Does **not** commit — the caller owns the
    transaction (``get_db`` or the Celery task's session).
    """
    if type not in DEFAULT_PREFERENCES:
        return None

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        return None
    if not get_notification_preferences(user).get(type, True):
        return None

    if dedup_key:
        dup = await db.execute(
            select(Notification.id).where(
                Notification.user_id == user_id,
                Notification.dedup_key == dedup_key,
            )
        )
        if dup.scalar_one_or_none() is not None:
            return None

    notification = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        severity=severity,
        link=link,
        dedup_key=dedup_key,
        payload=metadata,
    )
    db.add(notification)
    await db.flush()
    return notification