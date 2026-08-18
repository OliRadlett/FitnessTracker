"""Training Plans API — CRUD + template-based plan generation."""

import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User
from app.models.training_plan import TrainingPlan, TrainingPlanDay
from app.schemas.training_plan import (
    TrainingPlanCreate,
    TrainingPlanRead,
    TrainingPlanUpdate,
    TrainingPlanSummary,
    TrainingPlanDayCreate,
    GeneratePlanRequest,
)
from app.services.auth import get_current_user

router = APIRouter()

VALID_PLAN_TYPES = {"custom", "build", "base", "peak", "taper", "recovery"}
VALID_PLAN_STATUSES = {"draft", "active", "completed", "archived"}
VALID_DAY_TYPES = {"rest", "easy", "moderate", "hard", "race"}


# ── Template generation ──────────────────────────────────────────────────

def _generate_plan_days(
    template_type: str,
    weeks: int,
    start_date: date,
    base_tss: float,
) -> list[TrainingPlanDayCreate]:
    """Generate training plan days from a template type.

    Patterns:
    - base: steady ~65% load, mostly easy/moderate
    - build: progressive weekly TSS increase (~5-10%/week), mix of moderate/hard
    - peak: highest load weeks, mostly hard + some race
    - taper: progressive reduction over final weeks
    - recovery: very low load, mostly rest/easy
    """
    days: list[TrainingPlanDayCreate] = []
    weekly_tss = base_tss

    for week in range(weeks):
        # Calculate progressive TSS based on template
        if template_type == "build":
            # Progressive increase: 8% per week
            week_tss = base_tss * (1 + 0.08 * week)
        elif template_type == "base":
            # Steady moderate load
            week_tss = base_tss * 0.65
        elif template_type == "peak":
            # High load with slight increase
            week_tss = base_tss * (1.1 + 0.02 * week)
        elif template_type == "taper":
            # Progressive reduction: 20% less each week
            week_tss = base_tss * (0.8 ** week)
        elif template_type == "recovery":
            # Very low load
            week_tss = base_tss * 0.3
        else:
            week_tss = base_tss

        daily_tss = week_tss / 6  # 6 training days, 1 rest

        for day_offset in range(7):
            day_date = start_date + timedelta(weeks=week, days=day_offset)
            dow = day_date.weekday()  # 0=Mon, 6=Sun

            if dow == 6:  # Sunday = rest
                days.append(TrainingPlanDayCreate(
                    day_date=day_date,
                    planned_tss=0,
                    planned_duration_min=0,
                    planned_type="rest",
                ))
            elif dow == 2:  # Wednesday = hard day
                tss = daily_tss * 1.4
                days.append(TrainingPlanDayCreate(
                    day_date=day_date,
                    planned_tss=round(tss, 1),
                    planned_duration_min=int(tss / 1.0),
                    planned_type="hard" if template_type != "recovery" else "easy",
                ))
            elif dow == 5:  # Saturday = long/hard day
                tss = daily_tss * 1.3
                ptype = "hard" if template_type in ("build", "peak") else "moderate"
                if template_type == "taper" and week == weeks - 1:
                    ptype = "race"
                days.append(TrainingPlanDayCreate(
                    day_date=day_date,
                    planned_tss=round(tss, 1),
                    planned_duration_min=int(tss / 0.9),
                    planned_type=ptype,
                ))
            else:  # Other days = moderate/easy
                if dow in (0, 4):  # Mon, Fri = moderate
                    tss = daily_tss * 0.9
                    ptype = "moderate" if template_type != "recovery" else "easy"
                else:  # Tue, Thu = easy
                    tss = daily_tss * 0.7
                    ptype = "easy"
                days.append(TrainingPlanDayCreate(
                    day_date=day_date,
                    planned_tss=round(tss, 1),
                    planned_duration_min=int(tss / 0.8),
                    planned_type=ptype,
                ))

    return days


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[TrainingPlanSummary])
async def list_plans(
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all training plans for the current user."""
    query = (
        select(TrainingPlan)
        .where(TrainingPlan.user_id == current_user.id)
        .options(selectinload(TrainingPlan.days))
        .order_by(TrainingPlan.created_at.desc())
    )
    if status_filter:
        query = query.where(TrainingPlan.status == status_filter)
    result = await db.execute(query)
    plans = list(result.scalars().unique().all())

    summaries = []
    for p in plans:
        total_days = len(p.days)
        completed_days = sum(1 for d in p.days if d.completed)
        summaries.append(TrainingPlanSummary(
            id=p.id,
            name=p.name,
            start_date=p.start_date,
            end_date=p.end_date,
            plan_type=p.plan_type,
            status=p.status,
            day_count=total_days,
            completed_days=completed_days,
        ))
    return summaries


@router.get("/{plan_id}", response_model=TrainingPlanRead)
async def get_plan(
    plan_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single training plan with all its days."""
    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.id == plan_id, TrainingPlan.user_id == current_user.id)
        .options(selectinload(TrainingPlan.days))
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Training plan not found")
    return TrainingPlanRead.model_validate(plan)


@router.post("", response_model=TrainingPlanRead, status_code=status.HTTP_201_CREATED)
async def create_plan(
    data: TrainingPlanCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new training plan with optional days."""
    if data.plan_type not in VALID_PLAN_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid plan_type. Must be one of: {', '.join(VALID_PLAN_TYPES)}")
    if data.end_date < data.start_date:
        raise HTTPException(status_code=400, detail="end_date must be after start_date")

    plan = TrainingPlan(
        user_id=current_user.id,
        name=data.name,
        description=data.description,
        start_date=data.start_date,
        end_date=data.end_date,
        plan_type=data.plan_type,
        status=data.status,
    )
    db.add(plan)
    await db.flush()

    for day_data in data.days:
        if day_data.planned_type not in VALID_DAY_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid planned_type: {day_data.planned_type}")
        day = TrainingPlanDay(plan_id=plan.id, **day_data.model_dump())
        db.add(day)

    await db.commit()

    # Re-fetch with relationships
    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.id == plan.id)
        .options(selectinload(TrainingPlan.days))
    )
    plan = result.scalar_one()
    return TrainingPlanRead.model_validate(plan)


@router.patch("/{plan_id}", response_model=TrainingPlanRead)
async def update_plan(
    plan_id: uuid.UUID,
    data: TrainingPlanUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a training plan. If days are provided, replace all existing days."""
    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.id == plan_id, TrainingPlan.user_id == current_user.id)
        .options(selectinload(TrainingPlan.days))
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Training plan not found")

    update_fields = data.model_dump(exclude_unset=True, exclude={"days"})
    for key, value in update_fields.items():
        setattr(plan, key, value)

    if data.days is not None:
        # Replace all days
        for day in plan.days:
            await db.delete(day)
        await db.flush()
        for day_data in data.days:
            day = TrainingPlanDay(plan_id=plan.id, **day_data.model_dump())
            db.add(day)

    await db.commit()

    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.id == plan.id)
        .options(selectinload(TrainingPlan.days))
    )
    plan = result.scalar_one()
    return TrainingPlanRead.model_validate(plan)


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(
    plan_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a training plan and all its days."""
    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.id == plan_id, TrainingPlan.user_id == current_user.id)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Training plan not found")
    await db.delete(plan)
    await db.commit()


# ── Template generation endpoint ──────────────────────────────────────────

@router.post("/generate", response_model=TrainingPlanRead, status_code=status.HTTP_201_CREATED)
async def generate_plan(
    data: GeneratePlanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Auto-generate a training plan from a template type."""
    if data.template_type not in VALID_PLAN_TYPES - {"custom"}:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid template_type. Must be one of: {', '.join(VALID_PLAN_TYPES - {'custom'})}",
        )
    if data.weeks < 1 or data.weeks > 24:
        raise HTTPException(status_code=400, detail="weeks must be between 1 and 24")
    if data.base_tss < 50 or data.base_tss > 1500:
        raise HTTPException(status_code=400, detail="base_tss must be between 50 and 1500")

    end_date = data.start_date + timedelta(weeks=data.weeks) - timedelta(days=1)
    days = _generate_plan_days(data.template_type, data.weeks, data.start_date, data.base_tss)

    plan = TrainingPlan(
        user_id=current_user.id,
        name=data.name,
        description=f"Auto-generated {data.template_type} plan ({data.weeks} weeks, base TSS {data.base_tss})",
        start_date=data.start_date,
        end_date=end_date,
        plan_type=data.template_type,
        status="draft",
    )
    db.add(plan)
    await db.flush()

    for day_data in days:
        day = TrainingPlanDay(plan_id=plan.id, **day_data.model_dump())
        db.add(day)

    await db.commit()

    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.id == plan.id)
        .options(selectinload(TrainingPlan.days))
    )
    plan = result.scalar_one()
    return TrainingPlanRead.model_validate(plan)
