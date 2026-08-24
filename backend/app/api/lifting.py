"""Lifting API — full CRUD for sessions/sets, PRs, volume endpoints, activity linking, warmup templates."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.lifting import LiftingSession
from app.models.user import User
from app.schemas.activity import ActivityRead
from app.schemas.lifting import (
    LiftingAnalysisResponse,
    LiftingSessionCreate,
    LiftingSessionLink,
    LiftingSessionRead,
    LiftingSessionUpdate,
    LiftingSetCreate,
    LiftingSetRead,
    LiftingSetUpdate,
    PersonalRecordCreate,
    PersonalRecordRead,
    VolumeTrendResponse,
    WarmupTemplateCreate,
    WarmupTemplateRead,
    WarmupTemplateUpdate,
)
from app.services import lifting as lifting_service
from app.services.auth import get_current_user
from app.services.exercise_db import search_exercises
from app.services.strava import link_all_unlinked_activities

router = APIRouter()


# ── Sessions ──────────────────────────────────────────────────────────────────


@router.post(
    "/sessions", response_model=LiftingSessionRead, status_code=status.HTTP_201_CREATED
)
async def create_session(
    data: LiftingSessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await lifting_service.create_session(db, current_user.id, data)
    return LiftingSessionRead.model_validate(session)


@router.get("/sessions")
async def list_sessions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session_date: str | None = Query(None, description="Filter by date (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List lifting sessions with pagination.

    Returns the session list with an X-Total-Count response header.
    Optionally filter by ``session_date`` (BUG-023).
    """
    from fastapi.responses import JSONResponse
    from sqlalchemy import func, select

    from app.models.lifting import LiftingSession

    # Get total count (with optional date filter)
    count_query = select(func.count(LiftingSession.id)).where(
        LiftingSession.user_id == current_user.id
    )
    if session_date:
        from datetime import date as _date

        try:
            filter_date = _date.fromisoformat(session_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
        count_query = count_query.where(LiftingSession.session_date == filter_date)
    count_result = await db.execute(count_query)
    total_count = int(count_result.scalar() or 0)

    sessions = await lifting_service.list_sessions(
        db, current_user.id, limit=limit, offset=offset, session_date=session_date
    )
    enriched = [LiftingSessionRead.model_validate(s) for s in sessions]
    return JSONResponse(
        content=[s.model_dump(mode="json") for s in enriched],
        headers={"X-Total-Count": str(total_count)},
    )


@router.get("/sessions/active", response_model=LiftingSessionRead | None)
async def get_active_session(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Latest unfinished live-tracked session (started via /lifting/live), or null."""
    session = await lifting_service.get_active_session(db, current_user.id)
    if not session:
        return None
    return LiftingSessionRead.model_validate(session)


@router.get("/sessions/{session_id}", response_model=LiftingSessionRead)
async def get_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await lifting_service.get_session(db, session_id, current_user.id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return LiftingSessionRead.model_validate(session)


@router.patch("/sessions/{session_id}", response_model=LiftingSessionRead)
async def update_session(
    session_id: uuid.UUID,
    data: LiftingSessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await lifting_service.update_session(
        db, session_id, current_user.id, data
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return LiftingSessionRead.model_validate(session)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deleted = await lifting_service.delete_session(db, session_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")


# ── Activity Linking ─────────────────────────────────────────────────────────


@router.put("/sessions/{session_id}/link", response_model=LiftingSessionRead)
async def link_session(
    session_id: uuid.UUID,
    data: LiftingSessionLink,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Link or unlink a lifting session to a Strava activity.

    Pass `activity_id` to link, or `{"activity_id": null}` to unlink.
    """
    session = await lifting_service.link_session_to_activity(
        db, session_id, current_user.id, data
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session or activity not found")
    return LiftingSessionRead.model_validate(session)


@router.get(
    "/sessions/{session_id}/linkable-activities", response_model=list[ActivityRead]
)
async def get_linkable_activities(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Find Strava strength activities that could be linked to this session.

    Returns activities on the same date (±1 day) with sport_type strength/powerlifting.
    """
    activities = await lifting_service.find_linkable_activities(
        db, current_user.id, session_id
    )
    return [ActivityRead.model_validate(a) for a in activities]


@router.post("/backfill-links")
async def backfill_links(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Attempt to auto-link all unlinked Strava strength activities to lifting sessions.

    Useful after initial Strava connection or when new lifting sessions are created.
    """
    linked_count = await link_all_unlinked_activities(db, current_user.id)
    return {
        "detail": f"Linked {linked_count} activities to lifting sessions",
        "linked_count": linked_count,
    }


# ── Sets ──────────────────────────────────────────────────────────────────────


@router.post(
    "/sessions/{session_id}/sets",
    response_model=LiftingSetRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_set(
    session_id: uuid.UUID,
    data: LiftingSetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lifting_set = await lifting_service.add_set(db, session_id, current_user.id, data)
    if not lifting_set:
        raise HTTPException(status_code=404, detail="Session not found")
    return LiftingSetRead.model_validate(lifting_set)


@router.patch("/sets/{set_id}", response_model=LiftingSetRead)
async def update_set(
    set_id: uuid.UUID,
    data: LiftingSetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lifting_set = await lifting_service.update_set(db, set_id, current_user.id, data)
    if not lifting_set:
        raise HTTPException(status_code=404, detail="Set not found")
    return LiftingSetRead.model_validate(lifting_set)


@router.delete("/sets/{set_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_set(
    set_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deleted = await lifting_service.delete_set(db, set_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Set not found")


# ── Personal Records ──────────────────────────────────────────────────────────


@router.get("/prs", response_model=list[PersonalRecordRead])
async def get_prs(
    exercise_name: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prs = await lifting_service.get_prs(
        db, current_user.id, exercise_name=exercise_name, limit=limit
    )
    return [PersonalRecordRead.model_validate(pr) for pr in prs]


# ── PR Cleanup ───────────────────────────────────────────────────────────────


@router.post("/prs/cleanup")
async def cleanup_prs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One-time cleanup: recalculate all PRs based on best remaining sets.

    Fixes orphaned PRs from deleted sets/sessions that existed before the
    PR recalculation fix was deployed.
    """
    cleaned = await lifting_service.cleanup_orphaned_prs(db, current_user.id)
    return {"detail": f"Cleaned up {len(cleaned)} exercises", "cleaned": cleaned}


# ── Exercises ────────────────────────────────────────────────────────────────


@router.get("/exercises")
async def list_exercises(
    q: str | None = Query(None, description="Search query (substring match)"),
    limit: int = Query(10, ge=1, le=50),
    current_user: User = Depends(get_current_user),
):
    """Search the built-in exercise database. Returns canonical names with categories."""
    results = search_exercises(q or "", limit=limit)
    return results


# ── Manual PR Entry ──────────────────────────────────────────────────────────


@router.post(
    "/prs", response_model=PersonalRecordRead, status_code=status.HTTP_201_CREATED
)
async def create_pr(
    data: PersonalRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually create a personal record (for sessions not logged in the app)."""
    pr = await lifting_service.create_manual_pr(db, current_user.id, data)
    return PersonalRecordRead.model_validate(pr)


# ── Volume Trends ─────────────────────────────────────────────────────────────


@router.get("/volume-trends", response_model=VolumeTrendResponse)
async def get_volume_trends(
    exercise_name: str | None = Query(None),
    weeks: int = Query(12, ge=1, le=52),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trends = await lifting_service.get_volume_trends(
        db, current_user.id, exercise_name=exercise_name, weeks=weeks
    )
    return VolumeTrendResponse(exercise_name=exercise_name, data=trends)


# ── Warmup Templates ─────────────────────────────────────────────────────────


@router.get("/warmup-templates", response_model=list[WarmupTemplateRead])
async def list_warmup_templates(
    exercise_name: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    templates = await lifting_service.list_warmup_templates(
        db, current_user.id, exercise_name=exercise_name
    )
    return [WarmupTemplateRead.model_validate(t) for t in templates]


@router.post(
    "/warmup-templates",
    response_model=WarmupTemplateRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_warmup_template(
    data: WarmupTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    template = await lifting_service.create_warmup_template(db, current_user.id, data)
    return WarmupTemplateRead.model_validate(template)


@router.get("/warmup-templates/{template_id}", response_model=WarmupTemplateRead)
async def get_warmup_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    template = await lifting_service.get_warmup_template(
        db, template_id, current_user.id
    )
    if not template:
        raise HTTPException(status_code=404, detail="Warmup template not found")
    return WarmupTemplateRead.model_validate(template)


@router.patch("/warmup-templates/{template_id}", response_model=WarmupTemplateRead)
async def update_warmup_template(
    template_id: uuid.UUID,
    data: WarmupTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    template = await lifting_service.update_warmup_template(
        db, template_id, current_user.id, data
    )
    if not template:
        raise HTTPException(status_code=404, detail="Warmup template not found")
    return WarmupTemplateRead.model_validate(template)


@router.delete(
    "/warmup-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_warmup_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deleted = await lifting_service.delete_warmup_template(
        db, template_id, current_user.id
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Warmup template not found")


# ── Session Analysis ─────────────────────────────────────────────────────────


@router.get("/sessions/{session_id}/analysis", response_model=LiftingAnalysisResponse)
async def get_session_analysis(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get comprehensive analysis of a lifting session."""
    from app.services.session_analysis import analyze_lifting_session

    analysis = await analyze_lifting_session(db, current_user.id, session_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return LiftingAnalysisResponse(**analysis)


# ── Per-Session AI Analysis ─────────────────────────────────────────────────


@router.get("/sessions/{session_id}/ai-analysis")
async def get_session_ai_analysis(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get cached AI analysis for a specific lifting session.

    Returns the most recent per-session LLM analysis, or null if none exists.
    """
    from app.models.llm_analysis import LlmAnalysis
    from app.schemas.llm_analysis import LlmAnalysisRead

    result = await db.execute(
        select(LlmAnalysis)
        .where(
            LlmAnalysis.user_id == current_user.id,
            LlmAnalysis.lifting_session_id == session_id,
        )
        .order_by(LlmAnalysis.created_at.desc())
        .limit(1)
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        return None
    return LlmAnalysisRead.model_validate(analysis)


@router.post("/sessions/{session_id}/ai-analysis")
async def trigger_session_ai_analysis(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate an AI analysis for a specific lifting session.

    Uses Gemini to analyze the session data in the context of the user's
    recent lifting volume, PRs, recovery, and training trends.
    """
    from app.models.llm_analysis import LlmAnalysis
    from app.schemas.llm_analysis import LlmAnalysisRead
    from app.services.llm_analysis import run_lifting_session_ai_analysis

    # Verify session exists and belongs to user
    result = await db.execute(
        select(LiftingSession).where(
            LiftingSession.id == session_id,
            LiftingSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        analysis = await run_lifting_session_ai_analysis(
            db, current_user.id, session_id
        )
        if analysis is None:
            raise HTTPException(status_code=404, detail="Session not found")
        await db.commit()
        return LlmAnalysisRead.model_validate(analysis)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e!s}")
