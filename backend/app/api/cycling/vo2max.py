"""Cycling API — VO2max estimation and decoupling analysis endpoints."""

import uuid as uuid_mod
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.cycling import (
    DecouplingActivityPoint,
    DecouplingHistoryResponse,
    DecouplingSingleResponse,
    Vo2maxDetail,
    Vo2maxHistoryPoint,
    Vo2maxHistoryResponse,
    Vo2maxResponse,
)
from app.services.auth import get_current_user
from app.services.cycling import (
    _classify_vo2max,
    compute_decoupling_for_activity,
    compute_decoupling_history,
    compute_vo2max_history,
    estimate_vo2max,
)

router = APIRouter()


# ── VO2max Estimation ──────────────────────────────────────────────────────


@router.get("/vo2max", response_model=Vo2maxResponse)
async def get_vo2max_estimate(
    days: int = Query(90, ge=7, le=365, description="Lookback period in days"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Estimate VO2max from power and HR data.

    Uses ACSM power-based formula (best 5-min power) and Uth HR-based formula.
    Returns the highest estimate with classification.
    """
    result = await estimate_vo2max(db, current_user.id, days)
    if not result:
        raise HTTPException(
            status_code=404,
            detail="Insufficient data to estimate VO2max. Need cycling activities with power streams or heart rate data.",
        )

    return Vo2maxResponse(
        vo2max=result.vo2max,
        confidence=result.confidence,
        method=result.method,
        classification=_classify_vo2max(result.vo2max),
        all_estimates=[Vo2maxDetail(**e) for e in result.all_estimates],
    )


@router.get("/vo2max-history", response_model=Vo2maxHistoryResponse)
async def get_vo2max_history(
    months: int = Query(12, ge=3, le=24, description="Number of months to analyze"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get VO2max trend over time from monthly power data snapshots."""
    history = await compute_vo2max_history(db, current_user.id, months=months)

    data = [
        Vo2maxHistoryPoint(date=h["date"], vo2max=h["vo2max"], method=h["method"])
        for h in history
    ]

    current_vo2max = data[-1].vo2max if data else None
    current_classification = (
        _classify_vo2max(current_vo2max) if current_vo2max else None
    )

    return Vo2maxHistoryResponse(
        data=data,
        current_vo2max=current_vo2max,
        current_classification=current_classification,
    )


# ── Decoupling Analysis ────────────────────────────────────────────────────


@router.get("/decoupling", response_model=DecouplingHistoryResponse)
async def get_decoupling_history(
    days: int = Query(90, ge=7, le=365, description="Lookback period in days"),
    min_duration: int = Query(
        60, ge=20, le=600, description="Minimum ride duration in minutes"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get HR vs power decoupling trend for recent long rides.

    Decoupling measures aerobic fitness — how much power:HR ratio declines
    in the second half of a ride. <5% = excellent, 5-8% = acceptable, >8% = aerobic deficiency.
    """
    history = await compute_decoupling_history(
        db, current_user.id, days=days, min_duration_minutes=min_duration
    )

    data = [
        DecouplingActivityPoint(
            date=h["date"].date() if hasattr(h["date"], "date") else h["date"],
            activity_id=h["activity_id"],
            decoupling_pct=h["decoupling_pct"],
            first_half_ratio=h["first_half_ratio"],
            second_half_ratio=h["second_half_ratio"],
            classification=h["classification"],
            duration_seconds=h["duration_seconds"],
        )
        for h in history
    ]

    avg_pct = None
    classification = None
    if data:
        avg_pct = round(sum(d.decoupling_pct for d in data) / len(data), 1)
        from app.services.cycling import _classify_decoupling

        classification = _classify_decoupling(avg_pct)

    return DecouplingHistoryResponse(
        data=data,
        avg_decoupling_pct=avg_pct,
        classification=classification,
    )


@router.get("/decoupling/{activity_id}", response_model=DecouplingSingleResponse)
async def get_decoupling_for_activity(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get decoupling analysis for a specific activity."""
    try:
        act_uuid = uuid_mod.UUID(activity_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid activity ID")

    result = await compute_decoupling_for_activity(db, act_uuid, user_id=current_user.id)
    if not result:
        raise HTTPException(
            status_code=404,
            detail="No power and heart rate stream data available for this activity",
        )

    return DecouplingSingleResponse(
        decoupling_pct=result.decoupling_pct,
        first_half_ratio=result.first_half_ratio,
        second_half_ratio=result.second_half_ratio,
        classification=result.classification,
        duration_seconds=result.duration_seconds,
        activity_id=str(result.activity_id) if result.activity_id else None,
    )
