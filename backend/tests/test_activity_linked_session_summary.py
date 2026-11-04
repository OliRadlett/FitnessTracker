"""Unit tests for the linked lifting-session summary.

The journal names a lift after the exercise it actually trained, because every
activity's own name is "… Weight Training". `top_exercise` / `top_weight_kg`
are computed from the already-eager-loaded sets, so these tests run without a
database — they pin the derivation, not the query.
"""

import uuid
from datetime import date
from types import SimpleNamespace

from app.api.activities import _build_linked_session_summary


def _set(name: str, weight: float | None):
    return SimpleNamespace(exercise_name=name, weight_kg=weight)


def _activity(sets, *, focus="Push", volume=5326.0, tss=58.7):
    session = SimpleNamespace(
        id=uuid.uuid4(),
        session_date=date(2026, 11, 3),
        focus=focus,
        sets=sets,
        total_volume_kg=volume,
        estimated_tss=tss,
    )
    return SimpleNamespace(lifting_session=session)


def test_top_exercise_is_the_one_with_most_sets():
    summary = _build_linked_session_summary(
        _activity(
            [
                _set("Bench Press", 90),
                _set("Bench Press", 90),
                _set("Tricep Extension", 36),
            ]
        )
    )

    assert summary.top_exercise == "Bench Press"
    assert summary.set_count == 3
    assert summary.top_weight_kg == 90.0
    assert summary.top_weights == [90.0, 90.0, 36.0]
    assert summary.estimated_tss == 58.7


def test_no_lifting_session_returns_none():
    assert _build_linked_session_summary(SimpleNamespace(lifting_session=None)) is None


def test_session_without_sets_still_reports_itself():
    summary = _build_linked_session_summary(_activity([]))

    assert summary is not None
    assert summary.set_count == 0
    assert summary.top_exercise is None
    assert summary.top_weight_kg is None


def test_blank_exercise_names_are_not_a_name():
    summary = _build_linked_session_summary(
        _activity([_set("   ", 20), _set("Squat", 120)])
    )

    assert summary.top_exercise == "Squat"
    assert summary.top_weight_kg == 120.0


def test_a_tie_resolves_to_the_first_seen_exercise():
    """Sets are ordered by (order_index, created_at, id), so "first seen" is
    deterministic rather than dict-order luck."""
    summary = _build_linked_session_summary(
        _activity([_set("Bench Press", 90), _set("Close Grip Bench Press", 70)])
    )

    assert summary.top_exercise == "Bench Press"


def test_search_matches_name_route_and_lift_focus():
    """`q` used to search `Activity.name` alone — the one field that carries no
    information (every ride is "Cycling", every lift "… Weight Training"). The
    row shows a route name and an exercise name, so search has to reach both.
    Compiled rather than executed: this pins the shape without a database."""
    from sqlalchemy import select
    from sqlalchemy.dialects import postgresql

    from app.api.activities import _activity_search_clause
    from app.models.activity import Activity

    sql = str(
        select(Activity.id)
        .where(_activity_search_clause("bench"))
        .compile(dialect=postgresql.dialect())
    )

    assert "activities.name ILIKE" in sql
    assert "routes.name ILIKE" in sql
    assert "lifting_sessions.focus ILIKE" in sql
    assert "lifting_sets.exercise_name ILIKE" in sql
    # route EXISTS + lift EXISTS + sets EXISTS
    assert sql.count("EXISTS") == 3

