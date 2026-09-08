"""Web Push delivery (RFC 8292 / VAPID) for in-app notifications.

Fully optional: when ``VAPID_PUBLIC_KEY``/``VAPID_PRIVATE_KEY`` are unset every
send is a no-op (mirrors the ``GEMINI_API_KEY`` skip-graceful pattern). Delivery
failures are tracked per subscription; permanently-dead endpoints (410) are
pruned so we don't burn attempts forever.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.push import PushSubscription

logger = logging.getLogger(__name__)

# pywebpush is only installed in the runtime image; guard the import so unit
# environments without the package don't crash the API on import.
try:
    from pywebpush import WebPushException, webpush
except ImportError:  # pragma: no cover - exercised in minimal test envs
    WebPushException = Exception  # type: ignore[assignment,misc]
    webpush = None  # type: ignore[assignment]

MAX_CONSECUTIVE_FAILURES = 5


def _vapid_claims() -> dict[str, str]:
    settings = get_settings()
    return {"sub": settings.vapid_subject}


async def register_subscription(
    db: AsyncSession,
    user_id: uuid.UUID,
    endpoint: str,
    p256dh: str,
    auth: str,
) -> PushSubscription:
    """Upsert a device subscription for a user (idempotent by endpoint)."""
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == endpoint)
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        sub = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
        )
        db.add(sub)
    else:
        sub.user_id = user_id
        sub.p256dh = p256dh
        sub.auth = auth
        sub.consecutive_failures = 0
    await db.flush()
    return sub


async def unregister_subscription(
    db: AsyncSession,
    user_id: uuid.UUID,
    endpoint: str,
) -> bool:
    """Remove a subscription. Returns True if one was deleted."""
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint == endpoint,
        )
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        return False
    await db.delete(sub)
    await db.flush()
    return True


async def list_subscriptions(
    db: AsyncSession, user_id: uuid.UUID
) -> list[PushSubscription]:
    result = await db.execute(
        select(PushSubscription)
        .where(PushSubscription.user_id == user_id)
        .order_by(PushSubscription.created_at)
    )
    return list(result.scalars().all())


async def send_push_to_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    type: str,
    title: str,
    body: str,
    link: str = "",
    notification_id: str | None = None,
) -> bool:
    """Deliver a Web Push to every device subscription of a user.

    Returns True if any push was dispatched. Skips silently when VAPID keys are
    unset or the user has no subscriptions. Failures are recorded on the
    subscription and never raised — a dead device must not break the in-app
    notification transaction it rides on.
    """
    settings = get_settings()
    if not settings.push_enabled:
        return False
    if webpush is None:
        return False

    subs = await list_subscriptions(db, user_id)
    if not subs:
        return False

    payload = json.dumps(
        {
            "type": type,
            "title": title,
            "body": body,
            "link": link,
            "notification_id": notification_id,
        },
        ensure_ascii=False,
    )
    claims = _vapid_claims()

    sent = False
    for sub in subs:
        try:
            await _send(sub, payload, claims)
            sub.consecutive_failures = 0
            sub.last_error_at = None
            sent = True
        except Exception as exc:
            sub.consecutive_failures += 1
            sub.last_error_at = datetime.utcnow()
            logger.warning("Web push failed for subscription %s: %s", sub.id, exc)
            await db.flush()
            if sub.consecutive_failures >= MAX_CONSECUTIVE_FAILURES or _is_gone(exc):
                logger.info("Pruning dead push subscription %s", sub.id)
                await db.delete(sub)
    await db.flush()
    return sent


async def _send(sub: PushSubscription, payload: str, claims: dict[str, str]) -> None:
    """One delivery attempt. Returns when delivered, raises on failure."""
    settings = get_settings()
    await asyncio.to_thread(
        webpush,
        subscription_info={
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        },
        data=payload,
        vapid_private_key=settings.vapid_private_key,
        vapid_claims=claims,
        timeout=10,
    )


def _is_gone(exc: BaseException) -> bool:
    """A 404/410 response means the endpoint no longer exists (device wiped,
    user revoked notifications) — prune it immediately."""
    if isinstance(exc, WebPushException):
        status = getattr(exc, "response", None)
        code = getattr(status, "status_code", None)
        return code in (404, 410)
    return False
