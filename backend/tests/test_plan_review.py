"""C3 — weekly plan review (pure helpers)."""

from __future__ import annotations

from datetime import date

from app.services.plan_review import monday_of


def test_monday_of_returns_the_containing_monday():
    assert monday_of(date(2026, 8, 3)) == date(2026, 8, 3)  # Monday → itself
    assert monday_of(date(2026, 8, 5)) == date(2026, 8, 3)  # Wednesday → Monday
    assert monday_of(date(2026, 8, 9)) == date(2026, 8, 3)  # Sunday → Monday
