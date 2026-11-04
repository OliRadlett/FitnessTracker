"""Account endpoints (§3.9) — account deletion with GDPR-safe cascade.

Deletion is a single DB `DELETE` on the users row; every per-user child table
has `ForeignKey(..., ondelete="CASCADE")`, so Postgres removes all related rows
(including encrypted OAuth tokens on connections) transactionally and
efficiently without ORM-side object loading. Requires the user to confirm with
their exact account email — a hard-coded double-check against accidental taps.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.lifting import LiftVideo
from app.models.user import User
from app.services.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


class DeleteAccountRequest(BaseModel):
    confirm_email: str


@router.delete("/delete")
async def delete_account(
    payload: DeleteAccountRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Permanently delete this account and all its data.

    The caller must send their exact account email in ``confirm_email``. The
    delete relies on DB-level `ON DELETE CASCADE` foreign keys, so it extends
    to every child collection in one transaction.
    """
    if (payload.confirm_email or "").strip().lower() != current_user.email.lower():
        raise HTTPException(
            status_code=422,
            detail="Confirmation email does not match your account email",
        )

    # The DB cascade removes video rows but cannot remove the objects those
    # rows point at. Collect every key before deleting the user, then delete
    # them best-effort: an R2 outage must not block account deletion.
    video_rows = await db.execute(
        select(LiftVideo).where(LiftVideo.user_id == current_user.id)
    )
    video_keys = [
        key
        for video in video_rows.scalars().all()
        for key in (
            video.r2_key,
            video.trimmed_r2_key,
            video.overlay_r2_key,
            video.rep_thumbnails_r2_key,
            video.pose_track_r2_key,
        )
        if key
    ]
    if video_keys:
        try:
            from app.integrations.r2 import delete_object
        except Exception as exc:  # boto3 optional
            logger.warning("R2 delete client unavailable during account delete: %s", exc)
        else:
            for key in video_keys:
                try:
                    await delete_object(key)
                except Exception as exc:  # best-effort
                    logger.warning("Failed to delete R2 object %s: %s", key, exc)

    result = await db.execute(delete(User).where(User.id == current_user.id))
    if result.rowcount != 1:
        raise HTTPException(status_code=404, detail="Account not found")
    # No explicit commit — get_db commits after the endpoint returns (BUG-015).
    return {"deleted": True}
