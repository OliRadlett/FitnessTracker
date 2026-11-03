"""Canonical Big-3 lift mapping.

The Big-3 total is a competition-lift total: back squat, bench press, deadlift.
Squat *variants* (belt, box, front, hack, pause) are accessories and must never
enter the total, even when their estimated 1RM is higher.

Kept free of DB/config imports so it can be unit-tested without a database.
"""

from __future__ import annotations

CANONICAL_BIG3: dict[str, str] = {
    "back squat": "Squat",
    "bench press": "Bench Press",
    "deadlift": "Deadlift",
}


def canonical_big3_bucket(exercise_name: str) -> str | None:
    """Return the Big-3 bucket for an exact competition lift, else None.

    Exact match after trim/case-fold. Deliberately not a substring match:
    "belt squat" contains "squat" but is not the competition lift.
    """
    return CANONICAL_BIG3.get(exercise_name.strip().lower())


def canonical_big3_total(values: dict[str, float | None]) -> float:
    """Sum the known Big-3 bests, ignoring gaps."""
    return round(sum(v for v in values.values() if v is not None), 1)
