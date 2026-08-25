"""Exercise library service — CRUD and search backed by the exercises table.

Falls back to the static exercise_db for normalisation when the DB is empty
(e.g. before migration runs).
"""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.exercise import Exercise


async def search_exercises(
    db: AsyncSession,
    user_id: uuid.UUID | None,
    query: str = "",
    limit: int = 15,
) -> list[dict[str, str]]:
    """Search exercises by name (case-insensitive substring).

    Returns global + user-owned exercises.  Ordered: big3 first, then
    compound, then accessory, with starts-with ranked above contains.
    """
    query_lower = query.strip().lower()

    # Build base filter: global (user_id IS NULL) or owned by this user.
    base = or_(Exercise.user_id.is_(None), Exercise.user_id == user_id)

    if query_lower:
        stmt = (
            select(Exercise)
            .where(base, Exercise.is_active == True)
            .where(Exercise.name.ilike(f"%{query_lower}%"))
        )
    else:
        stmt = (
            select(Exercise)
            .where(base, Exercise.is_active == True)
        )

    result = await db.execute(stmt)
    rows = list(result.scalars().all())

    # Sort: category order then starts-with then alphabetical.
    cat_order = {"big3": 0, "compound": 1, "accessory": 2}

    def sort_key(ex: Exercise) -> tuple:
        name_lower = ex.name.lower()
        starts = 0 if (query_lower and name_lower.startswith(query_lower)) else 1
        return (cat_order.get(ex.category, 3), starts, name_lower)

    rows.sort(key=sort_key)
    return [{"name": ex.name, "category": ex.category} for ex in rows[:limit]]


async def get_all_exercises(
    db: AsyncSession,
    user_id: uuid.UUID | None,
) -> list[dict[str, str]]:
    """Return all active exercises in display order."""
    return await search_exercises(db, user_id, query="", limit=9999)


async def create_exercise(
    db: AsyncSession,
    user_id: uuid.UUID | None,
    name: str,
    category: str = "accessory",
    aliases: list[str] | None = None,
) -> Exercise:
    """Create a new exercise.  Raises ValueError on duplicate."""
    # Check for duplicate (global or per-user).
    base = or_(Exercise.user_id.is_(None), Exercise.user_id == user_id)
    existing = await db.execute(
        select(Exercise).where(base, Exercise.name.ilike(name))
    )
    if existing.scalar_one_or_none():
        raise ValueError(f"Exercise '{name}' already exists")

    ex = Exercise(
        user_id=user_id,
        name=name.strip(),
        category=category,
        aliases=aliases,
    )
    db.add(ex)
    await db.flush()
    return ex


async def update_exercise(
    db: AsyncSession,
    user_id: uuid.UUID,
    exercise_id: uuid.UUID,
    name: str | None = None,
    category: str | None = None,
    aliases: list[str] | None = None,
    is_active: bool | None = None,
) -> Exercise:
    """Update a user-owned exercise.  Raises ValueError if not found."""
    result = await db.execute(
        select(Exercise).where(
            Exercise.id == exercise_id,
            Exercise.user_id == user_id,
        )
    )
    ex = result.scalar_one_or_none()
    if not ex:
        raise ValueError("Exercise not found or not owned by you")

    if name is not None:
        ex.name = name.strip()
    if category is not None:
        ex.category = category
    if aliases is not None:
        ex.aliases = aliases
    if is_active is not None:
        ex.is_active = is_active

    await db.flush()
    return ex


async def delete_exercise(
    db: AsyncSession,
    user_id: uuid.UUID,
    exercise_id: uuid.UUID,
) -> None:
    """Delete a user-owned exercise.  Raises ValueError if not found."""
    result = await db.execute(
        select(Exercise).where(
            Exercise.id == exercise_id,
            Exercise.user_id == user_id,
        )
    )
    ex = result.scalar_one_or_none()
    if not ex:
        raise ValueError("Exercise not found or not owned by you")

    await db.delete(ex)
    await db.flush()


async def normalise_exercise_name(
    db: AsyncSession,
    user_id: uuid.UUID | None,
    raw: str,
) -> str:
    """Normalise a user-provided exercise name using the DB + static fallback.

    1. Exact match (case-insensitive) in DB
    2. Alias match in DB
    3. Fall back to static exercise_db.normalise_exercise_name
    """
    raw_stripped = raw.strip()
    if not raw_stripped:
        return raw_stripped

    # Try exact DB match first.
    base = or_(Exercise.user_id.is_(None), Exercise.user_id == user_id)
    result = await db.execute(
        select(Exercise).where(
            base,
            Exercise.is_active == True,
            Exercise.name.ilike(raw_stripped),
        )
    )
    match = result.scalar_one_or_none()
    if match:
        return match.name

    # Try alias match in DB.
    result = await db.execute(
        select(Exercise).where(
            base,
            Exercise.is_active == True,
        )
    )
    for ex in result.scalars().all():
        if ex.aliases and raw_stripped.lower() in ex.aliases:
            return ex.name

    # Fall back to static DB.
    from app.services.exercise_db import normalise_exercise_name as static_normalise

    return static_normalise(raw_stripped)
