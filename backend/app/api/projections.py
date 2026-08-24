"""Projections API — trend analysis, goal projections, and TSB forecasting (Phase 7).

Thin router over ``services.projections``.  Follows the same DI pattern as
other API modules (``get_db`` + ``get_current_user``).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.projections import (
    GoalProjectionResponse,
    MetricTrendResponse,
    TsbProjectionResponse,
)
from app.services.auth import get_current_user
from app.services.projections import (
    compute_goal_projection,
    compute_metric_trend,
    compute_tsb_projection,
)

router = APIRouter()


@router.get("/goal/{goal_id}", response_model=GoalProjectionResponse)
async def get_goal_projection(
    goal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Full projection for a goal: trend, projected date, badge, history, projection line."""
    try:
        result = await compute_goal_projection(db, current_user.id, goal_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return result


@router.get("/metric/{metric_key}", response_model=MetricTrendResponse)
async def get_metric_trend(
    metric_key: str,
    months: int = Query(default=6, ge=1, le=24),
    filter_json: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trend for any metric in the registry."""
    import json

    parsed_filter = None
    if filter_json:
        try:
            parsed_filter = json.loads(filter_json)
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(
                status_code=400, detail="filter_json must be valid JSON"
            )

    try:
        result = await compute_metric_trend(
            db, current_user.id, metric_key, parsed_filter, months
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.get("/tsb/{plan_id}", response_model=TsbProjectionResponse)
async def get_tsb_projection(
    plan_id: uuid.UUID,
    days: int = Query(default=14, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """TSB projection for event-linked training plans only."""
    try:
        result = await compute_tsb_projection(db, current_user.id, plan_id, days)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result
