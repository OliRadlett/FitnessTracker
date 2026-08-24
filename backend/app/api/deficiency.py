"""Deficiency API — training weakness/deficiency analysis endpoint."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.deficiency import DeficiencyResponse
from app.services.auth import get_current_user
from app.services.deficiency import analyze_deficiencies

router = APIRouter()


@router.get("", response_model=DeficiencyResponse)
async def get_deficiency_analysis(
    weeks: int = Query(default=8, ge=4, le=26, description="Look-back window in weeks"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analyze training weaknesses across lifting and cycling.

    Detects bodyweight strength-standard gaps (Big 3), Big-3 ratio
    imbalances, push/pull volume imbalance, VO2max/FTP mismatch,
    aerobic decoupling trends, and power-zone distribution issues.
    Returns weaknesses sorted by severity plus a severity summary.
    """
    weeks_clamped = max(4, min(26, weeks))  # belt-and-braces clamp
    return await analyze_deficiencies(db, current_user.id, weeks=weeks_clamped)
