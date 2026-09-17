"""Cycling power PR API — list, create, and check cycling power records.

Endpoints:
  GET  /api/v1/cycling/prs              — list all cycling power PRs
  POST /api/v1/cycling/prs              — manually create/update a PR
  POST /api/v1/cycling/prs/check        — trigger PR detection (single activity or all)
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import Activity
from app.models.user import User
from app.schemas.cycling import (
    CyclingPowerRecordCreate,
    CyclingPowerRecordRead,
    PrCheckRequest,
    PrCheckResponse,
)
from app.services.auth import get_current_user
from app.services.cycling import (
    check_and_record_cycling_prs,
    check_cycling_prs_all_activities,
    create_manual_cycling_pr,
    get_cycling_prs,
)

router = APIRouter()


@router.get("/prs", response_model=list[CyclingPowerRecordRead])
async def list_cycling_prs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    duration_label: str | None = Query(
        None, description="Filter by duration label (e.g. '5s', '20min', 'max')"
    ),
    limit: int = Query(50, ge=1, le=200),
):
    """List the current user's cycling power PRs, ordered by duration."""
    prs = await get_cycling_prs(
        db, current_user.id, duration_label=duration_label, limit=limit
    )
    result = []
    for pr in prs:
        read = CyclingPowerRecordRead.model_validate(pr)
        read.activity_name = pr.activity.name if pr.activity else None
        result.append(read)
    return result


@router.post("/prs", response_model=CyclingPowerRecordRead)
async def create_cycling_pr(
    data: CyclingPowerRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually create or update a cycling power PR.

    If an existing PR for the same ``duration_label`` has a higher power value,
    it is returned unchanged. Otherwise the record is created or updated in-place.
    """
    pr = await create_manual_cycling_pr(db, current_user.id, data)
    await db.commit()
    await db.refresh(pr)
    return CyclingPowerRecordRead.model_validate(pr)


@router.post("/prs/check", response_model=PrCheckResponse)
async def check_cycling_prs(
    data: PrCheckRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trigger cycling power PR detection.

    - If ``activity_id`` is provided, checks that specific activity against stored PRs.
    - If omitted, performs a full rescan of all the user's cycling activities.
    """
    if data and data.activity_id:
        activity = await db.get(Activity, data.activity_id)
        if not activity or activity.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Activity not found")
        if activity.sport_type != "cycling":
            raise HTTPException(
                status_code=400, detail="Activity is not a cycling activity"
            )

        updated = await check_and_record_cycling_prs(db, current_user.id, activity)
        await db.commit()
        new_count = len([p for p in updated if p.improvement_pct is None or p.improvement_pct > 0])
        result_prs = []
        for p in updated:
            read = CyclingPowerRecordRead.model_validate(p)
            read.activity_name = p.activity.name if p.activity else None
            result_prs.append(read)
        return PrCheckResponse(
            checked=1,
            new_prs=new_count,
            updated_prs=len(updated),
            prs=result_prs,
        )
    else:
        updated = await check_cycling_prs_all_activities(db, current_user.id)
        await db.commit()
        new_count = len([p for p in updated if p.improvement_pct is None or p.improvement_pct > 0])
        result_prs = []
        for p in updated:
            read = CyclingPowerRecordRead.model_validate(p)
            read.activity_name = p.activity.name if p.activity else None
            result_prs.append(read)
        return PrCheckResponse(
            checked=1,
            new_prs=new_count,
            updated_prs=len(updated),
            prs=result_prs,
        )
