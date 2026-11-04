"""Day status precedence in the training week grid.

A completed day used to be reported as ``pending`` whenever its date was today
or later, because the date branch came first. The plan card then showed a
finished session as not done all day.
"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest

from app.services.training_plan import day_status_for

TODAY = date(2026, 11, 4)


def _day(**overrides):
    fields = {
        "sport": "strength",
        "day_date": TODAY,
        "completed": False,
        "activity_id": None,
        "lifting_session_id": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"completed": True}, "completed"),
        ({"day_date": TODAY}, "pending"),
        ({"day_date": TODAY, "completed": True}, "completed"),
        ({"day_date": date(2026, 11, 1), "completed": True}, "completed"),
        (
            {"day_date": date(2026, 11, 1), "activity_id": "activity-1"},
            "partial",
        ),
        ({"day_date": date(2026, 11, 1)}, "missed"),
        ({"sport": "rest", "completed": True}, "rest"),
    ],
)
def test_day_status_prefers_completed_over_the_date(overrides, expected):
    assert day_status_for(_day(**overrides), TODAY) == expected
