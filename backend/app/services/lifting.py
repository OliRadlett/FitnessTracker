"""Lifting service — CRUD, volume calculation, PR detection (Brzycki formula), activity linking, warmup templates."""

import uuid
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity
from app.models.lifting import (
    LiftingSession,
    LiftingSet,
    PersonalRecord,
    WarmupTemplate,
    WarmupTemplateStep,
)
from app.schemas.lifting import (
    LiftingSessionCreate,
    LiftingSessionLink,
    LiftingSessionUpdate,
    LiftingSetCreate,
    LiftingSetUpdate,
    PersonalRecordCreate,
    VolumeTrendPoint,
    WarmupTemplateCreate,
    WarmupTemplateUpdate,
)
from app.services.exercise_db import normalise_exercise_name

# ── Brzycki 1RM formula ──────────────────────────────────────────────────────


def brzycki_1rm(weight_kg: float, reps: int) -> float:
    """Estimated 1RM using Brzycki formula: weight × (36 / (37 - reps))."""
    if reps <= 0:
        return weight_kg
    if reps >= 37:
        return weight_kg * 2  # guard against division by zero
    return weight_kg * (36 / (37 - reps))


# ── Volume calculation ────────────────────────────────────────────────────────


def calculate_session_volume(sets: list[dict]) -> float:
    """Total volume = sum of (weight × reps) for non-warmup sets."""
    return sum(
        s["weight_kg"] * s["reps"]
        for s in sets
        if not s.get("is_warmup", False)
    )


# ── Session CRUD ──────────────────────────────────────────────────────────────


async def create_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: LiftingSessionCreate,
) -> LiftingSession:
    session = LiftingSession(
        user_id=user_id,
        session_date=data.session_date,
        program_name=data.program_name,
        focus=data.focus,
        duration_seconds=data.duration_seconds,
        rpe_session=data.rpe_session,
        notes=data.notes,
    )
    db.add(session)
    await db.flush()

    # Add sets
    for s in data.sets:
        lifting_set = LiftingSet(
            session_id=session.id,
            exercise_name=s.exercise_name,
            set_number=s.set_number,
            weight_kg=s.weight_kg,
            reps=s.reps,
            rpe=s.rpe,
            is_warmup=s.is_warmup,
            is_amrap=s.is_amrap,
            notes=s.notes,
        )
        db.add(lifting_set)

    await db.flush()

    # Calculate total volume
    volume = calculate_session_volume([s.model_dump() for s in data.sets])
    session.total_volume_kg = volume

    # Check for PRs on each set
    for s in data.sets:
        if not s.is_warmup:
            await _check_and_record_pr(db, user_id, s, session)

    await db.flush()

    # Reload with sets
    return await get_session(db, session.id, user_id)  # type: ignore[return-value]


async def get_session(
    db: AsyncSession,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> LiftingSession | None:
    result = await db.execute(
        select(LiftingSession)
        .options(selectinload(LiftingSession.sets), selectinload(LiftingSession.linked_activity))
        .where(LiftingSession.id == session_id, LiftingSession.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def list_sessions(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0,
) -> list[LiftingSession]:
    result = await db.execute(
        select(LiftingSession)
        .options(selectinload(LiftingSession.sets), selectinload(LiftingSession.linked_activity))
        .where(LiftingSession.user_id == user_id)
        .order_by(LiftingSession.session_date.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


async def update_session(
    db: AsyncSession,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    data: LiftingSessionUpdate,
) -> LiftingSession | None:
    session = await get_session(db, session_id, user_id)
    if not session:
        return None

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(session, field, value)

    await db.flush()
    # Re-fetch with relationships loaded to avoid MissingGreenlet on sets
    return await get_session(db, session.id, user_id)  # type: ignore[return-value]


async def delete_session(db: AsyncSession, session_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    session = await get_session(db, session_id, user_id)
    if not session:
        return False

    # Collect affected exercises before deletion for PR recalculation
    exercises_affected = {s.exercise_name for s in session.sets if not s.is_warmup}

    await db.delete(session)
    await db.flush()

    # Recalculate PRs for each affected exercise
    for exercise_name in exercises_affected:
        await _recalculate_pr_after_set_change(db, user_id, exercise_name)

    await db.flush()
    return True


# ── Activity Linking ─────────────────────────────────────────────────────────


async def link_session_to_activity(
    db: AsyncSession,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    data: LiftingSessionLink,
) -> LiftingSession | None:
    """Link (or unlink) a lifting session to a Strava activity."""
    session = await get_session(db, session_id, user_id)
    if not session:
        return None

    if data.activity_id is not None:
        # Verify the activity exists and belongs to the user
        result = await db.execute(
            select(Activity).where(
                Activity.id == data.activity_id,
                Activity.user_id == user_id,
            )
        )
        activity = result.scalar_one_or_none()
        if not activity:
            return None

        # Unlink any other session that currently points to this activity
        existing_result = await db.execute(
            select(LiftingSession).where(
                LiftingSession.activity_id == data.activity_id,
                LiftingSession.id != session_id,
            )
        )
        for other_session in existing_result.scalars().all():
            other_session.activity_id = None

        session.activity_id = data.activity_id
        # Backfill duration from activity if session doesn't have one
        if not session.duration_seconds and activity.duration_seconds:
            session.duration_seconds = activity.duration_seconds
    else:
        # Unlink
        session.activity_id = None

    await db.flush()

    # Reload with relationships
    return await get_session(db, session_id, user_id)


async def find_linkable_activities(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
) -> list[Activity]:
    """Find Strava strength activities that could be linked to a lifting session.

    Returns activities on the same date (±1 day) that are strength-type and
    not already linked to another session.
    """
    session = await db.get(LiftingSession, session_id)
    if not session or session.user_id != user_id:
        return []

    session_date = session.session_date
    from datetime import timedelta
    date_low = session_date - timedelta(days=1)
    date_high = session_date + timedelta(days=1)

    # Get activity IDs already linked to other sessions
    linked_result = await db.execute(
        select(LiftingSession.activity_id).where(
            LiftingSession.user_id == user_id,
            LiftingSession.activity_id.is_not(None),
            LiftingSession.id != session_id,
        )
    )
    linked_ids = set(linked_result.scalars().all())

    result = await db.execute(
        select(Activity).where(
            Activity.user_id == user_id,
            Activity.source == "strava",
            Activity.sport_type.in_(("strength", "powerlifting", "weighttraining", "workout", "crossfit")),
            Activity.start_date >= date_low,
            Activity.start_date <= date_high,
        )
    )
    activities = list(result.scalars().all())

    # Filter out already-linked ones
    return [a for a in activities if a.id not in linked_ids]


# ── Set CRUD ──────────────────────────────────────────────────────────────────


async def add_set(
    db: AsyncSession,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    data: LiftingSetCreate,
) -> LiftingSet | None:
    session = await get_session(db, session_id, user_id)
    if not session:
        return None

    # Normalise exercise name
    normalised_name = normalise_exercise_name(data.exercise_name)

    lifting_set = LiftingSet(
        session_id=session_id,
        exercise_name=normalised_name,
        set_number=data.set_number,
        weight_kg=data.weight_kg,
        reps=data.reps,
        rpe=data.rpe,
        is_warmup=data.is_warmup,
        is_amrap=data.is_amrap,
        notes=data.notes,
    )
    db.add(lifting_set)

    # Update session volume
    if not data.is_warmup:
        current_volume = session.total_volume_kg or 0.0
        session.total_volume_kg = current_volume + (data.weight_kg * data.reps)

    await db.flush()

    # Check for PR
    if not data.is_warmup:
        await _check_and_record_pr(db, user_id, data, session)

    await db.flush()
    return lifting_set


async def update_set(
    db: AsyncSession,
    set_id: uuid.UUID,
    user_id: uuid.UUID,
    data: LiftingSetUpdate,
) -> LiftingSet | None:
    result = await db.execute(
        select(LiftingSet)
        .join(LiftingSession)
        .where(LiftingSet.id == set_id, LiftingSession.user_id == user_id)
    )
    lifting_set = result.scalar_one_or_none()
    if not lifting_set:
        return None

    # Capture old volume contribution before update
    was_warmup = lifting_set.is_warmup
    old_weight = lifting_set.weight_kg
    old_reps = lifting_set.reps
    old_exercise_name = lifting_set.exercise_name

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(lifting_set, field, value)

    # Recalculate session volume
    session = await db.get(LiftingSession, lifting_set.session_id)
    if session:
        if not was_warmup:
            old_volume = old_weight * old_reps
        else:
            old_volume = 0.0
        if not lifting_set.is_warmup:
            new_volume = lifting_set.weight_kg * lifting_set.reps
        else:
            new_volume = 0.0
        session.total_volume_kg = max(0.0, (session.total_volume_kg or 0.0) - old_volume + new_volume)

    await db.flush()

    # Re-check PRs for affected exercises (old name and new name if changed)
    exercises_to_check = {old_exercise_name}
    if lifting_set.exercise_name != old_exercise_name:
        exercises_to_check.add(lifting_set.exercise_name)
    for exercise_name in exercises_to_check:
        if not lifting_set.is_warmup or exercise_name == old_exercise_name:
            await _recalculate_pr_after_set_change(db, user_id, exercise_name)

    await db.flush()
    return lifting_set


async def delete_set(db: AsyncSession, set_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(LiftingSet)
        .join(LiftingSession)
        .where(LiftingSet.id == set_id, LiftingSession.user_id == user_id)
    )
    lifting_set = result.scalar_one_or_none()
    if not lifting_set:
        return False

    exercise_name = lifting_set.exercise_name
    is_warmup = lifting_set.is_warmup

    # Update session volume
    session = await db.get(LiftingSession, lifting_set.session_id)
    if session and not is_warmup:
        current_volume = session.total_volume_kg or 0.0
        session.total_volume_kg = max(0.0, current_volume - (lifting_set.weight_kg * lifting_set.reps))

    await db.delete(lifting_set)
    await db.flush()

    # Recalculate PRs for the affected exercise
    if not is_warmup:
        await _recalculate_pr_after_set_change(db, user_id, exercise_name)

    await db.flush()
    return True


# ── Personal Records ──────────────────────────────────────────────────────────


async def get_prs(
    db: AsyncSession,
    user_id: uuid.UUID,
    exercise_name: str | None = None,
    limit: int = 50,
) -> list[PersonalRecord]:
    query = select(PersonalRecord).where(PersonalRecord.user_id == user_id)
    if exercise_name:
        query = query.where(PersonalRecord.exercise_name == exercise_name)
    query = query.order_by(PersonalRecord.achieved_date.desc()).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def _check_and_record_pr(
    db: AsyncSession,
    user_id: uuid.UUID,
    set_data: LiftingSetCreate,
    session: LiftingSession,
) -> PersonalRecord | None:
    """Check if the set beats any existing PR for the exercise. Updates or creates a PR."""
    estimated_1rm = brzycki_1rm(set_data.weight_kg, set_data.reps)

    # Find current best 1RM for this exercise
    result = await db.execute(
        select(PersonalRecord)
        .where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.exercise_name == set_data.exercise_name,
            PersonalRecord.record_type == "1rm",
        )
        .order_by(PersonalRecord.estimated_1rm.desc())
        .limit(1)
    )
    current_pr = result.scalar_one_or_none()

    if current_pr is None:
        # No PR exists yet — create one
        pr = PersonalRecord(
            user_id=user_id,
            exercise_name=set_data.exercise_name,
            record_type="1rm",
            weight_kg=set_data.weight_kg,
            reps=set_data.reps,
            estimated_1rm=estimated_1rm,
            achieved_date=session.session_date,
            session_id=session.id,
        )
        db.add(pr)
        return pr
    elif estimated_1rm > (current_pr.estimated_1rm or 0):
        # Update existing PR in-place (deduplication)
        current_pr.weight_kg = set_data.weight_kg
        current_pr.reps = set_data.reps
        current_pr.estimated_1rm = estimated_1rm
        current_pr.achieved_date = session.session_date
        current_pr.session_id = session.id
        return current_pr

    return None


async def _recalculate_pr_after_set_change(
    db: AsyncSession,
    user_id: uuid.UUID,
    exercise_name: str,
) -> PersonalRecord | None:
    """Recalculate the best PR for an exercise after a set is deleted or updated.

    Finds the best remaining non-warmup set across all sessions and updates or
    removes the PR accordingly.
    """
    # Find existing PR for this exercise
    result = await db.execute(
        select(PersonalRecord)
        .where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.exercise_name == exercise_name,
            PersonalRecord.record_type == "1rm",
        )
        .limit(1)
    )
    existing_pr = result.scalar_one_or_none()

    # Find the best remaining set across all sessions for this exercise
    best_set_result = await db.execute(
        select(LiftingSet)
        .join(LiftingSession)
        .where(
            LiftingSession.user_id == user_id,
            LiftingSet.exercise_name == exercise_name,
            LiftingSet.is_warmup == False,
        )
        .order_by(
            # Order by estimated 1RM descending (best first)
            (LiftingSet.weight_kg * (36.0 / (37 - LiftingSet.reps))).desc()
        )
        .limit(1)
    )
    best_set = best_set_result.scalar_one_or_none()

    if best_set is None:
        # No sets remain for this exercise — delete the PR
        if existing_pr:
            await db.delete(existing_pr)
            await db.flush()
        return None

    best_1rm = brzycki_1rm(best_set.weight_kg, best_set.reps)

    if existing_pr:
        # Update the existing PR with the new best
        best_session = await db.get(LiftingSession, best_set.session_id)
        existing_pr.weight_kg = best_set.weight_kg
        existing_pr.reps = best_set.reps
        existing_pr.estimated_1rm = best_1rm
        existing_pr.session_id = best_set.session_id
        if best_session:
            existing_pr.achieved_date = best_session.session_date
        return existing_pr
    else:
        # Create a new PR for the remaining best set
        best_session = await db.get(LiftingSession, best_set.session_id)
        pr = PersonalRecord(
            user_id=user_id,
            exercise_name=exercise_name,
            record_type="1rm",
            weight_kg=best_set.weight_kg,
            reps=best_set.reps,
            estimated_1rm=best_1rm,
            achieved_date=best_session.session_date if best_session else date.today(),
            session_id=best_set.session_id,
        )
        db.add(pr)
        return pr


# ── Volume trends ─────────────────────────────────────────────────────────────


async def get_volume_trends(
    db: AsyncSession,
    user_id: uuid.UUID,
    exercise_name: str | None = None,
    weeks: int = 12,
) -> list[VolumeTrendPoint]:
    """Get weekly volume trends over the specified number of weeks."""
    cutoff = date.today() - timedelta(weeks=weeks)

    # Build the query to get weekly volume
    week_start = func.date_trunc("week", LiftingSession.session_date).label("week_start")

    query = (
        select(
            week_start,
            func.sum(LiftingSession.total_volume_kg).label("total_volume_kg"),
            func.count(LiftingSession.id).label("session_count"),
        )
        .where(
            LiftingSession.user_id == user_id,
            LiftingSession.session_date >= cutoff,
        )
        .group_by(week_start)
        .order_by(week_start)
    )

    result = await db.execute(query)
    rows = result.all()

    return [
        VolumeTrendPoint(
            week_start=row.week_start.date() if hasattr(row.week_start, "date") else row.week_start,
            total_volume_kg=float(row.total_volume_kg or 0),
            session_count=row.session_count,
        )
        for row in rows
    ]


# ── Warmup Templates ─────────────────────────────────────────────────────────


async def list_warmup_templates(
    db: AsyncSession,
    user_id: uuid.UUID,
    exercise_name: str | None = None,
) -> list[WarmupTemplate]:
    """List warmup templates, optionally filtered by exercise name."""
    query = (
        select(WarmupTemplate)
        .options(selectinload(WarmupTemplate.steps))
        .where(WarmupTemplate.user_id == user_id)
        .order_by(WarmupTemplate.name)
    )
    if exercise_name:
        query = query.where(WarmupTemplate.exercise_name.ilike(exercise_name))
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_warmup_template(
    db: AsyncSession,
    template_id: uuid.UUID,
    user_id: uuid.UUID,
) -> WarmupTemplate | None:
    result = await db.execute(
        select(WarmupTemplate)
        .options(selectinload(WarmupTemplate.steps))
        .where(WarmupTemplate.id == template_id, WarmupTemplate.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def create_warmup_template(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: WarmupTemplateCreate,
) -> WarmupTemplate:
    template = WarmupTemplate(
        user_id=user_id,
        name=data.name,
        exercise_name=data.exercise_name,
    )
    db.add(template)
    await db.flush()

    for s in data.steps:
        step = WarmupTemplateStep(
            warmup_template_id=template.id,
            step_number=s.step_number,
            weight_kg=s.weight_kg,
            reps=s.reps,
            notes=s.notes,
        )
        db.add(step)

    await db.flush()
    return await get_warmup_template(db, template.id, user_id)  # type: ignore[return-value]


async def update_warmup_template(
    db: AsyncSession,
    template_id: uuid.UUID,
    user_id: uuid.UUID,
    data: WarmupTemplateUpdate,
) -> WarmupTemplate | None:
    template = await get_warmup_template(db, template_id, user_id)
    if not template:
        return None

    # Update scalar fields
    update_data = data.model_dump(exclude_unset=True, exclude={"steps"})
    for field, value in update_data.items():
        setattr(template, field, value)

    # Replace steps if provided
    if data.steps is not None:
        # Remove existing steps
        for step in list(template.steps):
            await db.delete(step)
        await db.flush()

        # Add new steps
        for s in data.steps:
            step = WarmupTemplateStep(
                warmup_template_id=template.id,
                step_number=s.step_number,
                weight_kg=s.weight_kg,
                reps=s.reps,
                notes=s.notes,
            )
            db.add(step)

    await db.flush()
    return await get_warmup_template(db, template.id, user_id)  # type: ignore[return-value]


async def delete_warmup_template(
    db: AsyncSession,
    template_id: uuid.UUID,
    user_id: uuid.UUID,
) -> bool:
    template = await get_warmup_template(db, template_id, user_id)
    if not template:
        return False
    await db.delete(template)
    await db.flush()
    return True


# ── Manual PR Entry ──────────────────────────────────────────────────────────


async def create_manual_pr(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: PersonalRecordCreate,
) -> PersonalRecord:
    """Create a PR manually (for sessions not logged in the app)."""
    normalised_name = normalise_exercise_name(data.exercise_name)
    estimated_1rm = brzycki_1rm(data.weight_kg, data.reps)

    # Check if existing PR exists — update if new one is better, create otherwise
    result = await db.execute(
        select(PersonalRecord)
        .where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.exercise_name == normalised_name,
            PersonalRecord.record_type == data.record_type,
        )
        .limit(1)
    )
    existing_pr = result.scalar_one_or_none()

    if existing_pr and estimated_1rm > (existing_pr.estimated_1rm or 0):
        existing_pr.weight_kg = data.weight_kg
        existing_pr.reps = data.reps
        existing_pr.estimated_1rm = estimated_1rm
        existing_pr.achieved_date = data.achieved_date
        existing_pr.session_id = None
        if data.notes:
            existing_pr.notes = data.notes
        await db.flush()
        return existing_pr
    elif existing_pr:
        # Existing PR is still better — return it unchanged
        return existing_pr
    else:
        pr = PersonalRecord(
            user_id=user_id,
            exercise_name=normalised_name,
            record_type=data.record_type,
            weight_kg=data.weight_kg,
            reps=data.reps,
            estimated_1rm=estimated_1rm,
            achieved_date=data.achieved_date,
            session_id=None,
            notes=data.notes,
        )
        db.add(pr)
        await db.flush()
        return pr


async def cleanup_orphaned_prs(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[str]:
    """One-time cleanup: recalculate all PRs for the user.

    For each PR, find the best remaining set across all sessions and update
    or remove the PR. Returns a list of exercise names that were cleaned up.
    """
    result = await db.execute(
        select(PersonalRecord)
        .where(PersonalRecord.user_id == user_id)
    )
    prs = list(result.scalars().all())

    exercises_seen: set[str] = set()
    cleaned: list[str] = []

    for pr in prs:
        if pr.exercise_name in exercises_seen:
            continue
        exercises_seen.add(pr.exercise_name)

        # Find the best remaining set for this exercise
        best_set_result = await db.execute(
            select(LiftingSet)
            .join(LiftingSession)
            .where(
                LiftingSession.user_id == user_id,
                LiftingSet.exercise_name == pr.exercise_name,
                LiftingSet.is_warmup == False,
            )
            .order_by(
                (LiftingSet.weight_kg * (36.0 / (37 - LiftingSet.reps))).desc()
            )
            .limit(1)
        )
        best_set = best_set_result.scalar_one_or_none()

        if best_set is None:
            # No sets remain — delete all PRs for this exercise
            for p in prs:
                if p.exercise_name == pr.exercise_name:
                    await db.delete(p)
            cleaned.append(f"{pr.exercise_name} (deleted — no sets remain)")
        else:
            best_1rm = brzycki_1rm(best_set.weight_kg, best_set.reps)
            best_session = await db.get(LiftingSession, best_set.session_id)
            # Update all PRs for this exercise to the best remaining set
            for p in prs:
                if p.exercise_name == pr.exercise_name:
                    p.weight_kg = best_set.weight_kg
                    p.reps = best_set.reps
                    p.estimated_1rm = best_1rm
                    p.session_id = best_set.session_id
                    if best_session:
                        p.achieved_date = best_session.session_date
            cleaned.append(f"{pr.exercise_name} (updated to best remaining set)")

    await db.flush()
    return cleaned
