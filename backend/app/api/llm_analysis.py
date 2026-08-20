"""LLM Analysis API — on-demand and latest cycling analysis."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.llm_analysis import LlmAnalysis
from app.models.user import User
from app.schemas.llm_analysis import LlmAnalysisRead, LlmAnalysisSummary
from app.services.auth import get_current_user

router = APIRouter()


@router.get("/latest", response_model=LlmAnalysisRead | None)
async def get_latest_analysis(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the most recent LLM analysis for the current user."""
    result = await db.execute(
        select(LlmAnalysis)
        .where(LlmAnalysis.user_id == current_user.id)
        .order_by(LlmAnalysis.created_at.desc())
        .limit(1)
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        return None
    return LlmAnalysisRead.model_validate(analysis)


@router.post("/on-demand", response_model=LlmAnalysisRead)
async def trigger_analysis(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trigger an on-demand LLM cycling analysis."""
    from app.services.llm_analysis import run_llm_analysis

    try:
        analysis = await run_llm_analysis(db, current_user.id)
        await db.commit()
        return LlmAnalysisRead.model_validate(analysis)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e!s}")


@router.get("/history", response_model=list[LlmAnalysisSummary])
async def get_analysis_history(
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get LLM analysis history for the current user."""
    result = await db.execute(
        select(LlmAnalysis)
        .where(LlmAnalysis.user_id == current_user.id)
        .order_by(LlmAnalysis.created_at.desc())
        .limit(limit)
    )
    analyses = result.scalars().all()
    return [LlmAnalysisSummary.model_validate(a) for a in analyses]
