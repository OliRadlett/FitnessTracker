"""Cross-domain insights API — sleep-performance, cross-sport, race retrospective."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.cross_domain import CrossDomainInsight
from app.models.user import User
from app.services.auth import get_current_user

router = APIRouter()


@router.get("")
async def get_cross_domain_insights(
    insight_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get cross-domain insights for the current user.

    Returns sleep-performance correlations, cross-sport fatigue analysis,
    and race retrospective results. Filter by insight_type or get all.
    """
    query = (
        select(CrossDomainInsight)
        .where(CrossDomainInsight.user_id == current_user.id)
        .order_by(desc(CrossDomainInsight.created_at))
    )

    if insight_type:
        query = query.where(CrossDomainInsight.insight_type == insight_type)

    # Get latest of each type (limit to prevent large responses)
    query = query.limit(30)

    result = await db.execute(query)
    insights = list(result.scalars().all())

    if not insights:
        raise HTTPException(
            status_code=404,
            detail="No cross-domain insights found. Analysis runs weekly on Sundays.",
        )

    # Group by type and return latest per type
    by_type: dict[str, list] = {}
    for insight in insights:
        by_type.setdefault(insight.insight_type, []).append(insight)

    response = {}
    for itype, type_insights in by_type.items():
        latest = type_insights[0]  # already ordered by created_at desc
        response[itype] = {
            "results": latest.results,
            "insights": latest.insights,
            "data_quality": latest.data_quality,
            "analyzed_at": latest.created_at.isoformat() if latest.created_at else None,
            "period_start": latest.period_start.isoformat() if latest.period_start else None,
            "period_end": latest.period_end.isoformat() if latest.period_end else None,
        }

    return response


@router.get("/{insight_type}")
async def get_cross_domain_insight_by_type(
    insight_type: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the latest cross-domain insight of a specific type.

    Types: sleep_performance, cross_sport, race_retrospective
    """
    result = await db.execute(
        select(CrossDomainInsight)
        .where(
            CrossDomainInsight.user_id == current_user.id,
            CrossDomainInsight.insight_type == insight_type,
        )
        .order_by(desc(CrossDomainInsight.created_at))
        .limit(1)
    )
    insight = result.scalar_one_or_none()

    if not insight:
        raise HTTPException(
            status_code=404,
            detail=f"No '{insight_type}' insight found. Analysis runs weekly on Sundays.",
        )

    return {
        "results": insight.results,
        "insights": insight.insights,
        "data_quality": insight.data_quality,
        "analyzed_at": insight.created_at.isoformat() if insight.created_at else None,
        "period_start": insight.period_start.isoformat() if insight.period_start else None,
        "period_end": insight.period_end.isoformat() if insight.period_end else None,
    }
