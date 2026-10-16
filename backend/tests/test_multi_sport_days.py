"""Unit tests for the multi-sport date rules (no database).

``sports_conflict_on_date`` is the single predicate behind the add / copy /
reschedule guards and the undo restore clash, so it is tested directly rather
than only through the integration suite (which needs Postgres).
"""

from __future__ import annotations

from datetime import date

import pytest

from app.schemas.training_plan import TrainingPlanDayCreate
from app.services.training_plan import _validate_days, sports_conflict_on_date


class TestSportsConflictOnDate:
    @pytest.mark.parametrize(
        ("existing", "arriving"),
        [
            ("cycle", "cycle"),
            ("strength", "strength"),
            ("rest", "rest"),
            ("rest", "cycle"),
            ("rest", "strength"),
            ("cycle", "rest"),
            ("strength", "rest"),
        ],
    )
    def test_conflicts(self, existing: str, arriving: str):
        assert sports_conflict_on_date(existing, arriving) is True

    @pytest.mark.parametrize(
        ("existing", "arriving"),
        [("cycle", "strength"), ("strength", "cycle")],
    )
    def test_distinct_sports_share_a_date(self, existing: str, arriving: str):
        assert sports_conflict_on_date(existing, arriving) is False


class TestValidateDays:
    def test_accepts_two_sports_on_one_date(self):
        _validate_days(
            [
                TrainingPlanDayCreate(
                    day_date=date(2026, 8, 5), sport="cycle", planned_type="easy"
                ),
                TrainingPlanDayCreate(
                    day_date=date(2026, 8, 5), sport="strength", planned_type="moderate"
                ),
            ]
        )

    def test_rejects_the_same_sport_twice_on_one_date(self):
        with pytest.raises(ValueError, match="Duplicate cycle session"):
            _validate_days(
                [
                    TrainingPlanDayCreate(
                        day_date=date(2026, 8, 5), sport="cycle", planned_type="easy"
                    ),
                    TrainingPlanDayCreate(
                        day_date=date(2026, 8, 5), sport="cycle", planned_type="hard"
                    ),
                ]
            )

    def test_accepts_the_same_sport_on_different_dates(self):
        _validate_days(
            [
                TrainingPlanDayCreate(
                    day_date=date(2026, 8, 5), sport="cycle", planned_type="easy"
                ),
                TrainingPlanDayCreate(
                    day_date=date(2026, 8, 6), sport="cycle", planned_type="easy"
                ),
            ]
        )
