"""Undo surface (C6) — list live undo claims and perform one.

The mechanism lives in ``services/undo.py`` (claim-before-restore, typed
restorers, 30-day window); the registered kinds live in
``services/undo_plan.py``. Importing this router is what registers them.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services import undo as undo_service
from app.services.auth import get_current_user
from app.services.undo_plan import register_restorers

router = APIRouter()

# Register the plan-day restorers once, at import.
register_restorers()


@router.get("")
async def list_undos(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """This user's live undo claims, newest first."""
    logs = await undo_service.list_undoable(db, current_user.id)
    return [
        {
            "id": str(log.id),
            "kind": log.kind,
            "created_at": log.created_at.isoformat() if log.created_at else None,
            "expires_at": log.expires_at.isoformat() if log.expires_at else None,
            "payload": log.payload,
        }
        for log in logs
    ]


@router.post("/{log_id}")
async def perform_undo(
    log_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Perform an undo. 409 when unavailable (gone, expired, or already undone)."""
    try:
        result = await undo_service.undo(db, log_id, current_user.id)
    except undo_service.UndoNotAvailable as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"undone": True, "result": result}
