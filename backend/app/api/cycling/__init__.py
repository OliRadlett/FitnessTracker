"""Cycling API — Power analysis, training load, FTP management, cycling metrics."""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.cycling import FtpHistory
from app.models.user import User
from app.schemas.cycling import (
    CyclingProfileRead,
    CyclingProfileUpdate,
)
from app.services.auth import get_current_user
from app.services.cycling import get_or_create_cycling_profile

router = APIRouter()


# ── Cycling Profile ──────────────────────────────────────────────────────────


@router.get("/profile", response_model=CyclingProfileRead)
async def get_cycling_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the current user's cycling profile (FTP, weight)."""
    profile = await get_or_create_cycling_profile(db, current_user.id)
    await db.refresh(profile)
    return CyclingProfileRead.model_validate(profile)


@router.patch("/profile", response_model=CyclingProfileRead)
async def update_cycling_profile(
    payload: CyclingProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the current user's cycling profile. If FTP changes, also records history."""
    profile = await get_or_create_cycling_profile(db, current_user.id)

    if payload.ftp_watts is not None and payload.ftp_watts != profile.ftp_watts:
        # Record FTP history
        ftp_entry = FtpHistory(
            user_id=current_user.id,
            ftp_watts=payload.ftp_watts,
            effective_date=date.today(),
            source="manual",
        )
        db.add(ftp_entry)
        profile.ftp_watts = payload.ftp_watts

    if payload.weight_kg is not None:
        profile.weight_kg = payload.weight_kg

    if payload.lactate_threshold_hr is not None:
        profile.lactate_threshold_hr = payload.lactate_threshold_hr

    if payload.auto_estimate_ftp is not None:
        profile.auto_estimate_ftp = payload.auto_estimate_ftp

    await db.flush()
    await db.refresh(profile)
    return CyclingProfileRead.model_validate(profile)


# Include sub-routers
from app.api.cycling.ftp import router as ftp_router
from app.api.cycling.power import router as power_router
from app.api.cycling.training_load import router as training_load_router
from app.api.cycling.vo2max import router as vo2max_router

router.include_router(training_load_router)
router.include_router(power_router)
router.include_router(vo2max_router)
router.include_router(ftp_router)
