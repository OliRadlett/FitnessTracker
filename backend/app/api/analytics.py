"""Analytics API (Feature 3 / B-15) — deterministic athlete-model insights."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.athlete_insight import AthleteInsight
from app.models.llm_analysis import LlmAnalysis
from app.models.user import User
from app.services.analytics import INSIGHT_TYPES, compute_all_insights
from app.services.auth import get_current_user
from app.services.llm_base import ai_generation_guard

router = APIRouter()


class AthleteInsightRead(BaseModel):
    id: uuid.UUID
    insight_type: str
    period: str
    data: dict | None = None
    sample_size: int
    confidence: str

    model_config = {"from_attributes": True}


@router.get("/insights", response_model=list[AthleteInsightRead])
async def list_insights(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Latest computed insight per type (nightly task keeps these fresh)."""
    result = await db.execute(
        select(AthleteInsight)
        .where(
            AthleteInsight.user_id == current_user.id,
            AthleteInsight.insight_type.in_(INSIGHT_TYPES),
        )
        .order_by(AthleteInsight.insight_type, AthleteInsight.computed_at.desc())
    )
    seen: set[str] = set()
    latest = []
    for row in result.scalars().all():
        if row.insight_type not in seen:
            seen.add(row.insight_type)
            latest.append(row)
    return [AthleteInsightRead.model_validate(r) for r in latest]


@router.post("/recompute", response_model=list[AthleteInsightRead])
async def recompute_insights(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """On-demand recompute of all six insights for the current user."""
    try:
        rows = await compute_all_insights(db, current_user.id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recompute failed: {e!s}")
    # BUG-015: no explicit commit; get_db commits at return.
    return [AthleteInsightRead.model_validate(r) for r in rows]


# ── Feature 7 / B-18: AI interpretation over deterministic insights ──────────

from app.schemas.llm_analysis import LlmAnalysisRead


async def _latest_analysis(
    db: AsyncSession, user_id: uuid.UUID, analysis_type: str
) -> LlmAnalysis | None:
    result = await db.execute(
        select(LlmAnalysis)
        .where(
            LlmAnalysis.user_id == user_id,
            LlmAnalysis.analysis_type == analysis_type,
        )
        .order_by(LlmAnalysis.created_at.desc(), LlmAnalysis.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.post("/explain/{insight_type}", response_model=LlmAnalysisRead)
async def explain_insight(
    insight_type: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """AI interpretation of one computed insight (stored as LlmAnalysis)."""
    from app.services.llm_analysis import run_insight_explanation

    if insight_type not in INSIGHT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown insight: {insight_type!r}")
    try:
        async with ai_generation_guard(current_user.id, "insight_explain", insight_type):
            analysis = await run_insight_explanation(db, current_user.id, insight_type)
        return LlmAnalysisRead.model_validate(analysis)
    except HTTPException:
        raise
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Explanation failed: {e!s}")


@router.get("/explanations", response_model=list[LlmAnalysisRead])
async def list_explanations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Latest stored AI explanation per insight type (empty when none)."""
    result = await db.execute(
        select(LlmAnalysis)
        .where(
            LlmAnalysis.user_id == current_user.id,
            LlmAnalysis.analysis_type == "insight_explanation",
        )
        .order_by(LlmAnalysis.created_at.desc())
    )
    seen: set[str] = set()
    latest = []
    for row in result.scalars().all():
        key = (row.stats_json or {}).get("insight_type", str(row.id))
        if key not in seen:
            seen.add(key)
            latest.append(row)
    return [LlmAnalysisRead.model_validate(r) for r in latest]


@router.post("/season-overview", response_model=LlmAnalysisRead)
async def trigger_season_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Big-picture cross-domain season brief (stored as LlmAnalysis)."""
    from app.services.llm_analysis import run_season_overview_analysis

    try:
        async with ai_generation_guard(current_user.id, "season_overview"):
            analysis = await run_season_overview_analysis(db, current_user.id)
        return LlmAnalysisRead.model_validate(analysis)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Season overview failed: {e!s}")


@router.get("/season-overview", response_model=LlmAnalysisRead | None)
async def get_season_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Latest stored season overview, or null."""
    analysis = await _latest_analysis(db, current_user.id, "season_overview")
    return LlmAnalysisRead.model_validate(analysis) if analysis else None
