"""Web Push endpoints — subscription management + VAPID public key.

Frontend flow: fetch the VAPID public key, `pushManager.subscribe`, then POST
the resulting {endpoint, p256dh, auth} here. Delivery happens in `notify()`
via `services/push.send_push_to_user` when VAPID keys are configured.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.schemas.push import (
    PushSubscriptionCreate,
    PushSubscriptionList,
    PushSubscriptionRead,
    PushUnregister,
)
from app.services.auth import get_current_user
from app.services.push import (
    list_subscriptions,
    register_subscription,
    unregister_subscription,
)

router = APIRouter()


@router.get("/vapid-public-key")
async def vapid_public_key():
    settings = get_settings()
    if not settings.push_enabled:
        raise HTTPException(status_code=404, detail="Web Push is not configured")
    return {"public_key": settings.vapid_public_key}


@router.get("/subscriptions", response_model=PushSubscriptionList)
async def get_subscriptions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subs = await list_subscriptions(db, current_user.id)
    return {
        "subscriptions": [
            PushSubscriptionRead(
                id=str(s.id),
                endpoint=s.endpoint,
                created_at=s.created_at.isoformat() if s.created_at else None,
            )
            for s in subs
        ],
        "count": len(subs),
    }


@router.post("/subscriptions")
async def create_subscription(
    payload: PushSubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = await register_subscription(
        db, current_user.id, payload.endpoint, payload.p256dh, payload.auth
    )
    await db.commit()
    return PushSubscriptionRead(id=str(sub.id), endpoint=sub.endpoint, created_at=None)


@router.delete("/subscriptions")
async def remove_subscription(
    payload: PushUnregister,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not payload.endpoint:
        raise HTTPException(status_code=422, detail="endpoint is required")
    removed = await unregister_subscription(db, current_user.id, payload.endpoint)
    await db.commit()
    return {"removed": removed}
