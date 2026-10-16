"""Plan blocks (C1) -- the stored block/phase model.

A block is a named, dated range inside a plan. Two rules matter and neither can
be expressed on the block's fields alone: **containment** (a block cannot extend
past its plan) and **non-overlap** (two blocks cannot claim the same day). Both
are enforced here, where the plan and its siblings are loaded.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.training_plan import TrainingPlan, TrainingPlanBlock


class BlockConflict(ValueError):
    """The block cannot be stored: it is missing, malformed, or overlapping.

    A distinct type so the API can answer 404 / 400 / 409 for the three
    genuinely different mistakes instead of flattening them into one 400.
    """


async def _load_plan(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
) -> TrainingPlan:
    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.id == plan_id, TrainingPlan.user_id == user_id)
        .options(selectinload(TrainingPlan.blocks))
        # ``populate_existing`` forces an already-loaded ``blocks`` collection to
        # be re-read. Sessions are ``expire_on_commit=False`` (database.py), so a
        # plan loaded before a block existed keeps its empty collection and every
        # later read in that session would miss the new row — which reads as
        # "create succeeded, list is empty" and makes overlap validation blind.
        # Same reason ``_reload_plan`` sets it.
        .execution_options(populate_existing=True)
    )
    plan = result.scalar_one_or_none()
    if plan is None:
        raise BlockConflict("Training plan not found")
    return plan


def _validate_range(
    plan: TrainingPlan,
    start: date,
    end: date,
    siblings: list[TrainingPlanBlock],
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Reject a range that is backwards, outside the plan, or overlapping."""
    if end < start:
        raise BlockConflict("Block end date is before its start date")
    if start < plan.start_date or end > plan.end_date:
        raise BlockConflict(
            f"Block must sit inside the plan ({plan.start_date} to {plan.end_date})"
        )
    for other in siblings:
        if exclude_id is not None and other.id == exclude_id:
            continue
        # Inclusive ranges: a shared boundary day is an overlap, not a handoff.
        if start <= other.end_date and end >= other.start_date:
            raise BlockConflict(f"Block overlaps '{other.name}'")


async def list_blocks(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID
) -> list[TrainingPlanBlock]:
    """This plan's blocks, in date order (the relationship's own ordering)."""
    plan = await _load_plan(db, user_id, plan_id)
    return list(plan.blocks)


async def create_block(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID, data
) -> TrainingPlanBlock:
    plan = await _load_plan(db, user_id, plan_id)
    _validate_range(plan, data.start_date, data.end_date, list(plan.blocks))

    block = TrainingPlanBlock(plan_id=plan.id, **data.model_dump())
    db.add(block)
    await db.flush()
    return block


async def update_block(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID, block_id: uuid.UUID, data
) -> TrainingPlanBlock:
    plan = await _load_plan(db, user_id, plan_id)
    block = next((b for b in plan.blocks if b.id == block_id), None)
    if block is None:
        raise BlockConflict("Block not found")

    # ``exclude_unset`` is what makes this a PATCH: an omitted field is left
    # alone, an explicit null clears it.
    changes = data.model_dump(exclude_unset=True)
    # Validate the range the edit would *produce*, not just the fields it names.
    _validate_range(
        plan,
        changes.get("start_date", block.start_date),
        changes.get("end_date", block.end_date),
        list(plan.blocks),
        exclude_id=block.id,
    )
    for field, value in changes.items():
        setattr(block, field, value)
    await db.flush()
    return block


async def delete_block(
    db: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID, block_id: uuid.UUID
) -> None:
    plan = await _load_plan(db, user_id, plan_id)
    block = next((b for b in plan.blocks if b.id == block_id), None)
    if block is None:
        raise BlockConflict("Block not found")

    await db.delete(block)
    await db.flush()
