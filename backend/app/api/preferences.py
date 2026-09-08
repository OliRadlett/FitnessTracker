"""User UI preferences endpoints (unit system, locale, time format)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.preferences import UserPreferences, UserPreferencesUpdate
from app.services.auth import get_current_user
from app.services.preferences import get_preferences, set_preferences

router = APIRouter()


@router.get("/preferences", response_model=UserPreferences)
async def read_preferences(
    current_user: User = Depends(get_current_user),
):
    """Get the current user's UI preferences (unit system, locale, time format)."""
    return get_preferences(current_user)


@router.patch("/preferences", response_model=UserPreferences)
async def update_preferences(
    payload: UserPreferencesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update UI preferences (partial update supported)."""
    try:
        return await set_preferences(
            db, current_user, payload.model_dump(exclude_unset=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
