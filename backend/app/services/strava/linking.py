"""Strava service — activity-to-lifting session linking logic."""

import uuid
from datetime import timedelta
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity
from app.models.lifting import LiftingSession

# Sport types that represent strength/weight training (used in filters)
STRENGTH_SPORT_TYPES = (
    "strength",
    "powerlifting",
    "weighttraining",
    "workout",
    "crossfit",
)

# ── Exercise name extraction / matching ──────────────────────────────────────

# Common exercise keywords that map to lifting focus areas
_EXERCISE_KEYWORDS: dict[str, list[str]] = {
    "squat": ["squat", "squats", "back squat", "front squat", "leg press"],
    "bench": ["bench", "bench press", "chest press", "incline", "decline"],
    "deadlift": ["deadlift", "deadlifts", "romanian deadlift", "rdl", "rack pull"],
    "overhead_press": ["overhead", "ohp", "military press", "shoulder press", "press"],
    "upper_body": [
        "upper",
        "push",
        "pull",
        "chest",
        "back",
        "shoulder",
        "arms",
        "biceps",
        "triceps",
        "rows",
    ],
    "lower_body": ["lower", "legs", "leg", "glutes", "hamstrings", "quads", "calves"],
    "accessories": ["accessory", "accessories", "arms", "core", "abs", "isolation"],
}


def _extract_exercise_hints(name: str) -> set[str]:
    """Extract exercise focus hints from a Strava activity name.

    e.g. 'Squat Day — Heavy Singles' → {'squat'}
         'Upper Body Push' → {'upper_body', 'bench', 'overhead_press'}
         'Leg Press & Lunges' → {'squat', 'lower_body'}
    """
    name_lower = name.lower()
    hints: set[str] = set()
    for focus, keywords in _EXERCISE_KEYWORDS.items():
        for kw in keywords:
            if kw in name_lower:
                hints.add(focus)
                break
    return hints


def _focus_overlap_score(activity_hints: set[str], session_focus: str | None) -> float:
    """Score 0.0–1.0 based on how well activity name hints match session focus."""
    if not session_focus or not activity_hints:
        return 0.3  # neutral — neither confirms nor denies a match

    focus_lower = session_focus.lower().strip()
    # Direct keyword match on session focus
    for focus_key, keywords in _EXERCISE_KEYWORDS.items():
        if focus_key == focus_lower or focus_lower in keywords:
            if focus_key in activity_hints:
                return 1.0

    # Fuzzy match: check if session focus appears in activity hints' keywords
    for focus_key in activity_hints:
        keywords = _EXERCISE_KEYWORDS.get(focus_key, [])
        for kw in keywords:
            if SequenceMatcher(None, focus_lower, kw).ratio() > 0.6:
                return 0.8

    # Partial overlap — activity has multiple hints, one might match
    if activity_hints:
        return 0.2
    return 0.0


def _match_score(
    activity: Activity,
    session: LiftingSession,
) -> float:
    """Compute a match score (0.0–1.0) between a Strava strength activity and a lifting session.

    Factors:
    - Date proximity (same day = 1.0, 1 day off = 0.5, 2 days off = 0.1)
    - Duration similarity (within 30% = 1.0, degrades linearly)
    - Exercise name/focus overlap (via keyword extraction)
    """
    # 1. Date proximity
    activity_date = (
        activity.start_date.date()
        if activity.start_date.tzinfo
        else activity.start_date.date()
    )
    session_date = session.session_date
    day_diff = abs((activity_date - session_date).days)
    if day_diff == 0:
        date_score = 1.0
    elif day_diff == 1:
        date_score = 0.5
    elif day_diff == 2:
        date_score = 0.1
    else:
        return 0.0  # Too far apart, skip

    # 2. Duration similarity
    act_dur = activity.duration_seconds
    sess_dur = session.duration_seconds
    if act_dur and sess_dur and act_dur > 0 and sess_dur > 0:
        ratio = min(act_dur, sess_dur) / max(act_dur, sess_dur)
        duration_score = ratio  # 1.0 if equal, degrades linearly
    else:
        duration_score = 0.5  # Can't compare, neutral

    # 3. Exercise name / focus overlap
    activity_hints = _extract_exercise_hints(activity.name)
    exercise_score = _focus_overlap_score(activity_hints, session.focus)

    # Weighted combination
    return (date_score * 0.5) + (duration_score * 0.2) + (exercise_score * 0.3)


# ── Linking logic ────────────────────────────────────────────────────────────

MATCH_THRESHOLD = 0.55  # Minimum score to consider a match


async def link_activity_to_lifting_sessions(
    db: AsyncSession,
    activity: Activity,
) -> LiftingSession | None:
    """Attempt to link a newly synced Strava strength activity to an existing lifting session.

    Searches for lifting sessions on the same date (±2 days) that are not already linked.
    Returns the matched session, or None if no good match was found.
    """
    if activity.sport_type not in STRENGTH_SPORT_TYPES:
        return None

    # Already linked? — use an explicit query to avoid lazy-loading in async context.
    linked_check = await db.execute(
        select(LiftingSession.id)
        .where(LiftingSession.activity_id == activity.id)
        .limit(1)
    )
    if linked_check.scalar_one_or_none() is not None:
        return None

    activity_date = (
        activity.start_date.date()
        if activity.start_date.tzinfo
        else activity.start_date.date()
    )
    date_low = activity_date - timedelta(days=2)
    date_high = activity_date + timedelta(days=2)

    result = await db.execute(
        select(LiftingSession)
        .options(selectinload(LiftingSession.sets))
        .where(
            LiftingSession.user_id == activity.user_id,
            LiftingSession.session_date >= date_low,
            LiftingSession.session_date <= date_high,
            LiftingSession.activity_id.is_(None),  # Not already linked
        )
    )
    candidates = list(result.scalars().all())

    if not candidates:
        return None

    # Score each candidate and pick the best
    scored = [(session, _match_score(activity, session)) for session in candidates]
    scored.sort(key=lambda x: x[1], reverse=True)

    best_session, best_score = scored[0]
    if best_score < MATCH_THRESHOLD:
        return None

    # Link them
    best_session.activity_id = activity.id
    # Also backfill duration if session is missing it and activity has it
    if not best_session.duration_seconds and activity.duration_seconds:
        best_session.duration_seconds = activity.duration_seconds

    await db.flush()
    return best_session


async def link_all_unlinked_activities(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> int:
    """Backfill: attempt to link all unlinked Strava strength activities to lifting sessions.

    Returns the number of new links created.
    """
    # Get all strength activities from Strava that aren't linked to any lifting session
    result = await db.execute(
        select(Activity).where(
            Activity.user_id == user_id,
            Activity.source == "strava",
            Activity.sport_type.in_(STRENGTH_SPORT_TYPES),
        )
    )
    activities = list(result.scalars().all())

    # Filter to only those not already linked
    linked_ids_result = await db.execute(
        select(LiftingSession.activity_id).where(
            LiftingSession.user_id == user_id,
            LiftingSession.activity_id.is_not(None),
        )
    )
    linked_activity_ids = set(linked_ids_result.scalars().all())

    linked_count = 0
    for activity in activities:
        if activity.id in linked_activity_ids:
            continue
        match = await link_activity_to_lifting_sessions(db, activity)
        if match:
            linked_count += 1

    return linked_count
