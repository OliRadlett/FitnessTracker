"""Account endpoints (§3.9) — account deletion with GDPR-safe cascade.

Deletion is a single DB `DELETE` on the users row; every per-user child table
has `ForeignKey(..., ondelete="CASCADE")`, so Postgres removes all related rows
(including encrypted OAuth tokens on connections) transactionally and
efficiently without ORM-side object loading. Requires the user to confirm with
their exact account email — a hard-coded double-check against accidental taps.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.auth import get_current_user

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

    result = await db.execute(delete(User).where(User.id == current_user.id))
    if result.rowcount != 1:
        raise HTTPException(status_code=404, detail="Account not found")
    await db.commit()
    return {"deleted": True}
