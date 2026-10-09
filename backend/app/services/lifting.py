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

# Brzycki degrades beyond ~10-12 reps: a high-rep back-off set must never
# dethrone a true near-maximal PR via an inflated estimate, so only sets at
# or below this rep count contend for 1RM records.
MAX_REPS_FOR_1RM_PR = 12


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
        s["weight_kg"] * s["reps"] for s in sets if not s.get("is_warmup", False)
    )


# ── Lifting training load (B-31, formula revised for B2) ────────────────────
# Puts strength work on the same scale as cycling TSS so both can share one load
# chart. An estimate, labelled as one everywhere it surfaces.
#
# The original formula was `duration_min × avg_RPE / 7`. It rated a 3×3 at 200 kg
# and a 3×3 at 40 kg identically — it never looked at the work actually done,
# which is the entire point of a training-load metric.
#
# Foster's method: session load = tonnage × session RPE. Raw tonnage is not
# comparable between a 60 kg lifter and a 120 kg one, so it is divided by
# bodyweight first, giving a *volume load* in kg lifted per kg bodyweight. That
# makes the metric scale-free, and it is what separates "an hour of heavy
# singles" from "an hour of light technique work" — the case duration cannot see.
#
# LIFT_TSS_PER_VOLUME_LOAD maps volume load onto the TSS scale. It is a
# *display-scale* constant, not a physiological claim, and it keeps the anchor
# the old formula was built around: ~60 TSS for a one-hour session at RPE 7. A
# bodyweight-normalised hour of moderate lifting moves roughly 60 × bodyweight
# in tonnage (a volume load of ~60), and 60 × 0.7 × 1.4 ≈ 59.
LIFT_TSS_PER_VOLUME_LOAD = 1.4


def estimate_lifting_tss(
    duration_seconds: int | None,
    set_rpes: list[float | None],
    session_rpe: float | None = None,
    *,
    volume_kg: float | None = None,
    bodyweight_kg: float | None = None,
) -> float | None:
    """Training-load estimate: bodyweight-normalised tonnage × session RPE.

    ``volume_kg`` and ``bodyweight_kg`` must both be present to use the volume
    formula. When either is missing this falls back to the older
    duration × RPE estimate, which is the weaker of the two but still better
    than no number at all for a user who has never logged a weigh-in.

    Returns ``None`` only when there is neither volume nor a usable duration.
    """
    vals = [r for r in set_rpes if r is not None]
    avg_rpe = sum(vals) / len(vals) if vals else (session_rpe or 6.0)

    if volume_kg and bodyweight_kg and bodyweight_kg > 0:
        volume_load = volume_kg / bodyweight_kg
        return round(volume_load * (avg_rpe / 10.0) * LIFT_TSS_PER_VOLUME_LOAD, 1)

    if not duration_seconds or duration_seconds <= 0:
        return None
    return round(duration_seconds / 60 * avg_rpe / 7, 1)


def refresh_session_tss(
    session: LiftingSession, bodyweight_kg: float | None = None
) -> None:
    """Recompute ``estimated_tss`` from the session's current sets (in-memory)."""
    sets = list(session.sets or [])
    # Delegated to the canonical helper so the two definitions cannot drift.
    volume = calculate_session_volume(
        [
            {"weight_kg": s.weight_kg, "reps": s.reps, "is_warmup": s.is_warmup}
            for s in sets
            if not s.is_warmup
        ]
    )
    session.estimated_tss = estimate_lifting_tss(
        session.duration_seconds,
        [s.rpe for s in sets if not s.is_warmup],
        session.rpe_session,
        volume_kg=volume,
        bodyweight_kg=bodyweight_kg,
    )


async def latest_body_weight(db: AsyncSession, user_id: uuid.UUID) -> float | None:
    """Most recent logged bodyweight, or ``None`` if the user has never weighed in.

    Volume load is bodyweight-normalised, so this is what stands between a user
    with weigh-ins and the weaker duration-based fallback.
    """
    from app.models.weight import WeightLog

    result = await db.execute(
        select(WeightLog.weight_kilogram)
        .where(WeightLog.user_id == user_id)
        .order_by(WeightLog.date.desc())
        .limit(1)
    )
    weight = result.scalar_one_or_none()
    return float(weight) if weight and weight > 0 else None


async def backfill_lifting_tss(
    db: AsyncSession, user_id: uuid.UUID, *, force: bool = False
) -> int:
    """Recompute ``estimated_tss`` across the user's sessions.

    Returns the number of sessions updated. By default only rows still missing a
    value (or without a duration) are touched.

    ``force=True`` recomputes every session. That is the standing behaviour the
    weekly aggregation uses, and it is not just a one-off backfill: the value
    depends on bodyweight, which drifts, and on the sets, which are edited
    after the fact. Both are inputs the task can cheaply re-read, and the
    metric is fully derived from them, so recomputing is idempotent.
    """
    query = select(LiftingSession).where(LiftingSession.user_id == user_id)
    if not force:
        query = query.where(
            LiftingSession.estimated_tss.is_(None),
            LiftingSession.duration_seconds.isnot(None),
        )
    result = await db.execute(query)
    sessions = list(result.scalars().all())
    if not sessions:
        return 0
    bodyweight = await latest_body_weight(db, user_id)
    for session in sessions:
        await db.refresh(session, ["sets"])
        refresh_session_tss(session, bodyweight)
    await db.flush()
    return len(sessions)


# ── Implausible-duration fallback (Strava) ───────────────────────────────────

# A single lifting session this long is implausible — almost always a live
# session whose finish landed days late (killed tab, lost local state, then
# resume → finish against a stale started_at). When such a session is linked
# to a Strava activity, the activity's recorded duration/start are trusted
# instead.
MAX_PLAUSIBLE_SESSION_DURATION_SECONDS = 3 * 3600


def session_duration_implausible(duration_seconds: int | None) -> bool:
    """True when a stored session duration is too long to be a real workout."""
    return (
        duration_seconds is not None
        and duration_seconds >= MAX_PLAUSIBLE_SESSION_DURATION_SECONDS
    )


def session_span_implausible(session: LiftingSession) -> bool:
    """True when the session's stored duration OR wall-clock span is implausible."""
    if session_duration_implausible(session.duration_seconds):
        return True
    if session.started_at is not None and session.ended_at is not None:
        try:
            span = (session.ended_at - session.started_at).total_seconds()
        except (TypeError, OverflowError):
            return False
        if span >= MAX_PLAUSIBLE_SESSION_DURATION_SECONDS:
            return True
    return False


def apply_strava_duration_fallback(
    session: LiftingSession, activity: Activity | None
) -> bool:
    """Reset an implausibly long session to its linked Strava activity's time.

    Sets ``duration_seconds`` from the activity and realigns ``started_at`` /
    ``ended_at`` to the activity window. Returns True when the fallback was
    applied. No-op (False) when the session is plausible or the activity has
    no usable duration.
    """
    if not session_span_implausible(session):
        return False
    if (
        activity is None
        or not activity.duration_seconds
        or activity.duration_seconds <= 0
    ):
        return False
    session.duration_seconds = activity.duration_seconds
    if activity.start_date is not None:
        session.started_at = activity.start_date
        try:
            session.ended_at = activity.start_date + timedelta(
                seconds=activity.duration_seconds
            )
        except (TypeError, OverflowError):
            pass
    elif session.started_at is not None:
        try:
            session.ended_at = session.started_at + timedelta(
                seconds=activity.duration_seconds
            )
        except (TypeError, OverflowError):
            pass
    return True


# ── Session CRUD ──────────────────────────────────────────────────────────────


async def create_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: LiftingSessionCreate,
) -> LiftingSession:
    # Idempotent creation from the live tracker: a retry or concurrent flush
    # carrying the same live_key collapses onto the already-created session.
    if data.live_key:
        result = await db.execute(
            select(LiftingSession).where(
                LiftingSession.user_id == user_id,
                LiftingSession.live_key == data.live_key,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            return await get_session(db, existing.id, user_id)  # type: ignore[return-value]

    session = LiftingSession(
        user_id=user_id,
        session_date=data.session_date,
        program_name=data.program_name,
        focus=data.focus,
        duration_seconds=data.duration_seconds,
        rpe_session=data.rpe_session,
        notes=data.notes,
        started_at=data.started_at,
        live_key=data.live_key,
    )
    db.add(session)
    await db.flush()

    # Add sets. ``order_index`` follows the submitted order, which is the order
    # the user performed them — assigned from the position rather than from
    # created_at, since every row in this loop shares one transaction timestamp.
    for position, s in enumerate(data.sets):
        lifting_set = LiftingSet(
            session_id=session.id,
            exercise_name=normalise_exercise_name(s.exercise_name),
            set_number=s.set_number,
            order_index=position,
            weight_kg=s.weight_kg,
            reps=s.reps,
            rpe=s.rpe,
            is_warmup=s.is_warmup,
            is_amrap=s.is_amrap,
            notes=s.notes,
            client_id=s.client_id,
        )
        db.add(lifting_set)

    await db.flush()

    # Compacting here is safe even though all sets share a created_at: order_index
    # is now the total order, and this is exactly the 1, 1, 3 case it exists for.
    for exercise_name in {
        normalise_exercise_name(s.exercise_name) for s in data.sets
    }:
        await _renumber_exercise_sets(db, session.id, exercise_name)

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
        .options(
            selectinload(LiftingSession.sets),
            selectinload(LiftingSession.linked_activity),
        )
        .where(LiftingSession.id == session_id, LiftingSession.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def list_sessions(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0,
    session_date: str | None = None,
) -> list[LiftingSession]:
    query = (
        select(LiftingSession)
        .options(
            selectinload(LiftingSession.sets),
            selectinload(LiftingSession.linked_activity),
        )
        .where(LiftingSession.user_id == user_id)
    )
    if session_date:
        from datetime import date as _date

        try:
            filter_date = _date.fromisoformat(session_date)
        except ValueError:
            filter_date = None
        if filter_date:
            query = query.where(LiftingSession.session_date == filter_date)
    result = await db.execute(
        query.order_by(LiftingSession.session_date.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all())


async def get_active_session(
    db: AsyncSession, user_id: uuid.UUID
) -> LiftingSession | None:
    """Latest live-tracked session that hasn't been finished (for resume flow).

    Only sessions created via the live tracker have ``started_at`` set, so
    legacy/manual sessions never appear active.
    """
    result = await db.execute(
        select(LiftingSession)
        .options(
            selectinload(LiftingSession.sets),
            selectinload(LiftingSession.linked_activity),
        )
        .where(
            LiftingSession.user_id == user_id,
            LiftingSession.started_at.is_not(None),
            LiftingSession.ended_at.is_(None),
        )
        .order_by(LiftingSession.started_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


class ReorderMismatch(ValueError):
    """The submitted set list is not exactly the session's set list.

    A distinct type so the route maps it to 422 without catching unrelated
    ``ValueError``s raised elsewhere in the request.
    """


async def reorder_session_sets(
    db: AsyncSession,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    set_ids: list[uuid.UUID],
) -> LiftingSession | None:
    """Rewrite a session's set order from a complete, ordered id list.

    Returns the reloaded session, or None when the session is missing or not
    owned by ``user_id`` — both 404, so a caller cannot probe for another user's
    session.

    Raises ``ReorderMismatch`` when ``set_ids`` is not exactly the session's set
    list. Deliberately strict: a partial list cannot express a reorder, and
    guessing would risk silently dropping or duplicating sets. Because the check
    is a set comparison, re-sending the current order succeeds and changes
    nothing — the call is idempotent.

    Ordering is presentation only, so volume and PRs are not recomputed.
    """
    session = await get_session(db, session_id, user_id)
    if not session:
        return None

    current_ids = [s.id for s in session.sets]
    if len(set_ids) != len(current_ids) or set(set_ids) != set(current_ids):
        raise ReorderMismatch(
            "set_ids must list every set in the session exactly once "
            f"(expected {len(current_ids)}, received {len(set_ids)})"
        )

    position = {set_id: index for index, set_id in enumerate(set_ids)}
    for lifting_set in session.sets:
        lifting_set.order_index = position[lifting_set.id]
    await db.flush()

    # Re-sort the already-loaded collection. The relationship's ``order_by``
    # applies when the collection is *loaded*, so a re-query returns the
    # identity-mapped session with the stale order still attached — the writes
    # above are correct but the response would not reflect them.
    session.sets.sort(key=lambda s: (s.order_index, s.created_at, s.id))
    return session


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

    # Guard the live-finish path: a stale started_at (resume of a days-old
    # orphan) would otherwise store a multi-day duration verbatim. Fall back
    # to the linked Strava activity's recorded time instead.
    if session_span_implausible(session):
        activity = session.linked_activity
        if activity is None and session.activity_id is not None:
            activity = await db.get(Activity, session.activity_id)
        if activity is not None:
            apply_strava_duration_fallback(session, activity)

    # B-31: keep the load estimate current.
    refresh_session_tss(session, await latest_body_weight(db, session.user_id))
    await db.flush()
    # Re-fetch with relationships loaded to avoid MissingGreenlet on sets
    return await get_session(db, session.id, user_id)  # type: ignore[return-value]


async def delete_session(
    db: AsyncSession, session_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
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
        # …or when the stored time is implausibly long, default to the
        # linked activity's recorded time (and realign the window to it).
        elif session_span_implausible(session):
            apply_strava_duration_fallback(session, activity)
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
        select(Activity)
        .options(
            selectinload(Activity.sources),
            selectinload(Activity.route),
            selectinload(Activity.lifting_session).selectinload(LiftingSession.sets),
        )
        .where(
            Activity.user_id == user_id,
            Activity.source == "strava",
            Activity.sport_type.in_(
                ("strength", "powerlifting", "weighttraining", "workout", "crossfit")
            ),
            Activity.start_date >= date_low,
            Activity.start_date <= date_high,
        )
    )
    activities = list(result.scalars().all())

    # Filter out already-linked ones
    return [a for a in activities if a.id not in linked_ids]


# ── Set CRUD ──────────────────────────────────────────────────────────────────


async def _next_order_index(db: AsyncSession, session_id: uuid.UUID) -> int:
    """Next ``order_index`` for a set appended to ``session_id``.

    ``coalesce(max, -1) + 1`` so the first set is 0. Falls back correctly when
    every existing row still has a null ``order_index`` (pre-migration data or a
    session created between the column being added and the backfill running).
    """
    current = await db.execute(
        select(func.coalesce(func.max(LiftingSet.order_index), -1)).where(
            LiftingSet.session_id == session_id
        )
    )
    # An `or -1` here would be wrong: a session whose first set has order_index
    # 0 yields max = 0, which is falsy, so every append would recompute 0 and
    # collide with set 1. The SQL coalesce already covers the empty case, so no
    # sentinel is needed at all.
    return int(current.scalar()) + 1


async def _renumber_exercise_sets(
    db: AsyncSession,
    session_id: uuid.UUID,
    exercise_name: str,
) -> None:
    """Make ``set_number`` contiguous 1..n for one exercise within a session.

    ``set_number`` was client-supplied with no enforcement, so a session could
    legitimately hold 1, 1, 3. That ambiguity is why a superset ("bench 1-3 then
    row 1-3") was not expressible as data. Compacts in performance order, and is
    a no-op for an exercise with no sets.
    """
    result = await db.execute(
        select(LiftingSet)
        .where(
            LiftingSet.session_id == session_id,
            LiftingSet.exercise_name == exercise_name,
        )
        .order_by(
            LiftingSet.order_index,
            LiftingSet.created_at,
            LiftingSet.id,
        )
    )
    rows = list(result.scalars().all())
    for position, row in enumerate(rows, start=1):
        if row.set_number != position:
            row.set_number = position
    if rows:
        await db.flush()


async def add_set(
    db: AsyncSession,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    data: LiftingSetCreate,
) -> LiftingSet | None:
    session = await get_session(db, session_id, user_id)
    if not session:
        return None

    # Idempotent logging from the live tracker: a retry after a lost response
    # returns the already-created set instead of duplicating it.
    if data.client_id:
        result = await db.execute(
            select(LiftingSet).where(
                LiftingSet.session_id == session_id,
                LiftingSet.client_id == data.client_id,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            return existing

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
        client_id=data.client_id,
    )
    db.add(lifting_set)
    # Explicit performance order. Assigned here rather than relying on
    # created_at, which is the transaction timestamp in Postgres: every set from
    # one create_session call shares a value, so append order was previously
    # whatever the database returned.
    lifting_set.order_index = await _next_order_index(db, session_id)

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


# Fields a client is allowed to PATCH on a set. Kept as an explicit allowlist
# rather than a blanket ``setattr`` loop so that adding a field to
# ``LiftingSetUpdate`` fails visibly at review instead of silently becoming a
# raw-write path that bypasses the normalisation applied here.
_MUTABLE_SET_FIELDS = frozenset(
    {
        "exercise_name",
        "set_number",
        "weight_kg",
        "reps",
        "rpe",
        "is_warmup",
        "is_amrap",
        "notes",
    }
)


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
        if field not in _MUTABLE_SET_FIELDS:
            continue
        if field == "exercise_name" and value is not None:
            # ``exercise_name`` is the de facto key for every lifting view
            # (chart registry, PR correlation, video correlation, volume
            # trends, CSV export). ``create_session`` and ``add_set`` both store
            # the canonical form; a raw string written here would fork this set
            # off the exercise's entire history and mint a phantom PR, because
            # ``_recalculate_pr_after_set_change`` below runs on the new name.
            value = normalise_exercise_name(value)
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
        session.total_volume_kg = max(
            0.0, (session.total_volume_kg or 0.0) - old_volume + new_volume
        )

    # Re-check PRs for affected exercises (old name and new name if changed)
    exercises_to_check = {old_exercise_name}
    if lifting_set.exercise_name != old_exercise_name:
        exercises_to_check.add(lifting_set.exercise_name)
    for exercise_name in exercises_to_check:
        if not lifting_set.is_warmup or exercise_name == old_exercise_name:
            await _recalculate_pr_after_set_change(db, user_id, exercise_name)

    # Renumber whichever exercise groups this edit disturbed. Only needed when
    # the set moved between exercises: within one exercise an explicit
    # set_number edit is the caller's stated intent, and compacting here would
    # silently override it.
    if lifting_set.exercise_name != old_exercise_name:
        await _renumber_exercise_sets(
            db,
            lifting_set.session_id,
            lifting_set.exercise_name,
        )
        await _renumber_exercise_sets(db, lifting_set.session_id, old_exercise_name)

    # An edit does not change performance order, so order_index is untouched.
    # LiftingSetUpdate carries no order_index field, so the allowlist loop above
    # cannot have written it either.
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
        session.total_volume_kg = max(
            0.0, current_volume - (lifting_set.weight_kg * lifting_set.reps)
        )

    await db.delete(lifting_set)
    await db.flush()

    # Recalculate PRs for the affected exercise
    if not is_warmup:
        await _recalculate_pr_after_set_change(db, user_id, exercise_name)

    # Close the gap the deleted set left in its exercise's numbering. Deleting
    # bench 1 of 1-3 must leave 1-2, not 2-3, or "bench 1-3" stops being a
    # statement about the data.
    await _renumber_exercise_sets(db, lifting_set.session_id, exercise_name)

    await db.flush()
    return True


# ── Personal Records ──────────────────────────────────────────────────────────


async def _notify_pr(
    db: AsyncSession,
    user_id: uuid.UUID,
    pr: PersonalRecord,
) -> None:
    """Fire an in-app PR notification (deduped per exercise + achieved date)."""
    from app.services.notifications import notify

    est = f"{pr.estimated_1rm:.1f}" if pr.estimated_1rm else "—"
    await notify(
        db,
        user_id,
        type="pr",
        title=f"{pr.exercise_name} PR",
        body=f"{pr.weight_kg:.1f} kg × {pr.reps} — e1RM {est} kg",
        severity="success",
        link="/lifting",
        # Shared with _revoke_pr_notification so a retraction finds exactly the
        # row this wrote.
        dedup_key=_pr_dedup_key(pr),
        metadata={"exercise": pr.exercise_name},
    )


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
    """Check if the set beats any existing PR for the exercise. Updates or creates a PR.

    Only low-rep sets (``1..MAX_REPS_FOR_1RM_PR``) contend: Brzycki inflates
    rapidly beyond ~10 reps, so a high-rep back-off set must never dethrone a
    true near-maximal PR.
    """
    reps = set_data.reps or 0
    if reps <= 0 or reps > MAX_REPS_FOR_1RM_PR:
        return None

    exercise_name = normalise_exercise_name(set_data.exercise_name)
    estimated_1rm = brzycki_1rm(set_data.weight_kg, reps)

    # Find current best 1RM for this exercise
    result = await db.execute(
        select(PersonalRecord)
        .where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.exercise_name == exercise_name,
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
            exercise_name=exercise_name,
            record_type="1rm",
            weight_kg=set_data.weight_kg,
            reps=reps,
            estimated_1rm=estimated_1rm,
            achieved_date=session.session_date,
            session_id=session.id,
        )
        db.add(pr)
        await _notify_pr(db, user_id, pr)
        return pr
    elif estimated_1rm > (current_pr.estimated_1rm or 0):
        # Update existing PR in-place (deduplication)
        current_pr.weight_kg = set_data.weight_kg
        current_pr.reps = reps
        current_pr.estimated_1rm = estimated_1rm
        current_pr.achieved_date = session.session_date
        current_pr.session_id = session.id
        await _notify_pr(db, user_id, current_pr)
        return current_pr

    return None


def _pr_dedup_key(pr: PersonalRecord) -> str:
    """The dedup key ``_notify_pr`` uses for this record.

    Shared so the revoke path keys on exactly what the notify path wrote — if
    these two ever disagree, the stale notification is never found.
    """
    return f"pr:{pr.exercise_name}:{pr.achieved_date}"


async def _revoke_pr_notification(
    db: AsyncSession,
    user_id: uuid.UUID,
    pr: PersonalRecord,
) -> bool:
    """Retract the announcement for a PR that is being deleted.

    Two effects, both required:

    1. **Delete the stale notification.** Otherwise the user keeps a "Bench
       Press PR" entry for a record that no longer exists.
    2. **Free the dedup key.** ``notify`` suppresses any row matching the key,
       so leaving it in place means a genuinely re-earned PR on the same date
       is *silently* never announced again. The failure is symmetric — stale
       in one direction, permanently muted in the other.

    Then emit a compensating ``pr_revoked`` notification. This is not
    redundant: the original was delivered by web push, which has already
    reached the device and **cannot be unsent**. Silence would leave the user
    believing they still hold a PR, so the reversal has to be stated.

    Shares the caller's transaction on purpose (§3.2): if the notification
    delete committed but the PR delete rolled back, the user would lose the
    announcement for a PR they still hold *and* its dedup key — permanently
    silenced. Both or neither.
    """
    from app.models.notification import Notification
    from app.services.notifications import notify

    dedup_key = _pr_dedup_key(pr)
    result = await db.execute(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.dedup_key == dedup_key,
        )
    )
    stale = list(result.scalars().all())
    for row in stale:
        await db.delete(row)
    if stale:
        # Flush so the frees are visible to the dedup check in notify() below —
        # otherwise the compensating row's own key check sees the deleted one.
        await db.flush()

    await notify(
        db,
        user_id,
        type="pr_revoked",
        title=f"{pr.exercise_name} PR removed",
        body=(
            f"The {pr.exercise_name} record of "
            f"{pr.weight_kg:.1f} kg × {pr.reps} was removed — the set that set it "
            "is gone."
        ),
        severity="info",
        link="/lifting",
        # No dedup_key: a revocation is a distinct event and should never be
        # suppressed, even if the same PR is retracted twice.
        metadata={"exercise": pr.exercise_name, "revoked_date": str(pr.achieved_date)},
    )
    return bool(stale)


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

    # Find the best remaining set across all sessions for this exercise.
    # Only low-rep working sets contend for 1RM records (see
    # MAX_REPS_FOR_1RM_PR); the reps < 37 guard also protects the inline
    # Brzycki expression from division by zero (BUG-029).
    best_set_result = await db.execute(
        select(LiftingSet)
        .join(LiftingSession)
        .where(
            LiftingSession.user_id == user_id,
            LiftingSet.exercise_name == exercise_name,
            LiftingSet.is_warmup.is_(False),
            LiftingSet.reps >= 1,
            LiftingSet.reps <= MAX_REPS_FOR_1RM_PR,
            LiftingSet.reps < 37,
        )
        .order_by(
            # Order by estimated 1RM descending (best first)
            (LiftingSet.weight_kg * (36.0 / (37 - LiftingSet.reps))).desc()
        )
        .limit(1)
    )
    best_set = best_set_result.scalar_one_or_none()

    if best_set is None:
        # No sets remain for this exercise — delete the PR.
        #
        # The original "Bench Press PR" notification is an *out-of-band* effect
        # of the achievement, so deleting the record alone leaves it standing.
        # Worse, its dedup_key is what suppresses a future notification: re-log
        # the same lift on the same date and `notify` dedups against the stale
        # row, so the record can never be re-announced. One delete fixes both —
        # see revoke_pr_notification.
        if existing_pr:
            await _revoke_pr_notification(db, user_id, existing_pr)
            await db.delete(existing_pr)
            await db.flush()
        return None

    best_1rm = brzycki_1rm(best_set.weight_kg, best_set.reps)

    if existing_pr:
        # Update the existing PR with the new best
        previous_1rm = existing_pr.estimated_1rm or 0
        best_session = await db.get(LiftingSession, best_set.session_id)
        existing_pr.weight_kg = best_set.weight_kg
        existing_pr.reps = best_set.reps
        existing_pr.estimated_1rm = best_1rm
        existing_pr.session_id = best_set.session_id
        if best_session:
            existing_pr.achieved_date = best_session.session_date
        # Only notify when this recalculation genuinely improved the PR (a
        # set deletion that lowers it must not fire a "new PR" notification).
        if best_1rm > previous_1rm:
            await _notify_pr(db, user_id, existing_pr)
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
        await _notify_pr(db, user_id, pr)
        return pr


# ── e1RM resolution + load suggestion (FL3) ───────────────────────────────


async def resolve_exercise_e1rm(
    db: AsyncSession, user_id: uuid.UUID, exercise_name: str
) -> tuple[float | None, str]:
    """Current e1RM for an exercise: PR first, else best recent set (FL3).

    Normalises the name, then prefers the stored ``PersonalRecord``
    (``record_type == "1rm"`` with a non-null ``estimated_1rm``). When no PR
    exists, falls back to the best-set Brzycki estimate over non-warmup sets
    in the 1RM-valid rep range (same contention rules as the PR checks).
    Returns ``(e1rm_kg, source)`` where source is ``"pr"`` / ``"recent_sets"``
    / ``"none"`` (None e1RM when no history exists at all).
    """
    normalised = normalise_exercise_name(exercise_name)

    pr_result = await db.execute(
        select(PersonalRecord)
        .where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.exercise_name == normalised,
            PersonalRecord.record_type == "1rm",
            PersonalRecord.estimated_1rm.isnot(None),
        )
        .order_by(PersonalRecord.estimated_1rm.desc())
        .limit(1)
    )
    pr = pr_result.scalar_one_or_none()
    if pr is not None and pr.estimated_1rm:
        return float(pr.estimated_1rm), "pr"

    best_result = await db.execute(
        select(LiftingSet)
        .join(LiftingSession)
        .where(
            LiftingSession.user_id == user_id,
            LiftingSet.exercise_name == normalised,
            LiftingSet.is_warmup.is_(False),
            LiftingSet.reps >= 1,
            LiftingSet.reps <= MAX_REPS_FOR_1RM_PR,
            LiftingSet.reps < 37,
        )
        .order_by((LiftingSet.weight_kg * (36.0 / (37 - LiftingSet.reps))).desc())
        .limit(1)
    )
    best = best_result.scalar_one_or_none()
    if best is None:
        return None, "none"
    return brzycki_1rm(best.weight_kg, best.reps), "recent_sets"


async def suggest_strength_load(
    db: AsyncSession,
    user_id: uuid.UUID,
    exercise_name: str,
    sets: int,
    reps: int,
    pct_1rm: float = 0.8,
) -> dict:
    """Suggest a working weight as a fraction of the current e1RM (FL3).

    ``sets``/``reps`` describe the planned scheme (validated positive; they
    don't move the %1RM solve — recorded for future RPE autoregulation).
    Raises ``ValueError`` on out-of-range inputs (routers map it to 422).
    At ``pct_1rm >= 0.95`` the response carries a spotter/safety warning:
    near-maximal loads should be lifted with a spotter and safety bars.
    """
    if not exercise_name or not exercise_name.strip():
        raise ValueError("exercise_name is required")
    if sets < 1 or reps < 1:
        raise ValueError("sets and reps must be >= 1")
    if not 0.3 <= pct_1rm <= 1.0:
        raise ValueError("pct_1rm must be between 0.3 and 1.0")

    safety_warning = (
        "Near-maximal load (95%+ of 1RM) — use a spotter and safety bars."
        if pct_1rm >= 0.95
        else None
    )

    basis_1rm, source = await resolve_exercise_e1rm(db, user_id, exercise_name)
    if basis_1rm is None:
        return {
            "target_kg": None,
            "basis_1rm_kg": None,
            "pct_1rm": pct_1rm,
            "basis_source": "none",
            "safety_warning": safety_warning,
        }
    return {
        "target_kg": round(basis_1rm * pct_1rm, 1),
        "basis_1rm_kg": round(basis_1rm, 1),
        "pct_1rm": pct_1rm,
        "basis_source": source,
        "safety_warning": safety_warning,
    }


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
    week_start = func.date_trunc("week", LiftingSession.session_date).label(
        "week_start"
    )

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
            week_start=row.week_start.date()
            if hasattr(row.week_start, "date")
            else row.week_start,
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
    """Create a PR manually (for sessions not logged in the app).

    Raises ``ValueError`` when the rep count is outside the 1RM-valid range:
    high-rep estimates are not trustworthy enough to become records.
    """
    reps = data.reps or 0
    if reps <= 0 or reps > MAX_REPS_FOR_1RM_PR:
        raise ValueError(
            f"Manual 1RM records require 1–{MAX_REPS_FOR_1RM_PR} reps "
            f"(got {data.reps}) — Brzycki estimates beyond ~12 reps are unreliable."
        )
    normalised_name = normalise_exercise_name(data.exercise_name)
    estimated_1rm = brzycki_1rm(data.weight_kg, reps)

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
        await _notify_pr(db, user_id, existing_pr)
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
        await _notify_pr(db, user_id, pr)
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
        select(PersonalRecord).where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.record_type == "1rm",
        )
    )
    prs = list(result.scalars().all())

    exercises_seen: set[str] = set()
    cleaned: list[str] = []

    for pr in prs:
        if pr.exercise_name in exercises_seen:
            continue
        exercises_seen.add(pr.exercise_name)

        # Find the best remaining set for this exercise. Same contention
        # rules as live PR checks: working sets in the 1RM-valid rep range
        # (the reps < 37 guard also protects the inline Brzycki expression).
        best_set_result = await db.execute(
            select(LiftingSet)
            .join(LiftingSession)
            .where(
                LiftingSession.user_id == user_id,
                LiftingSet.exercise_name == pr.exercise_name,
                LiftingSet.is_warmup.is_(False),
                LiftingSet.reps >= 1,
                LiftingSet.reps <= MAX_REPS_FOR_1RM_PR,
                LiftingSet.reps < 37,
            )
            .order_by((LiftingSet.weight_kg * (36.0 / (37 - LiftingSet.reps))).desc())
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
