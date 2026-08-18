"""Tests for merge service — scoring functions (date, sport, duration, distance)."""

from datetime import datetime, timedelta

import pytest

from app.services.merge_service import (
    _date_proximity_score,
    _distance_score,
    _duration_score,
    _sport_type_score,
)


class TestDateProximityScore:
    """Date proximity scoring: 1.0 (≤30min) → 0.0 (different day)."""

    def test_same_time(self):
        dt = datetime(2025, 1, 15, 10, 0, 0)
        assert _date_proximity_score(dt, dt) == 1.0

    def test_within_30_min(self):
        d1 = datetime(2025, 1, 15, 10, 0, 0)
        d2 = d1 + timedelta(minutes=25)
        assert _date_proximity_score(d1, d2) == 1.0

    def test_exactly_30_min(self):
        d1 = datetime(2025, 1, 15, 10, 0, 0)
        d2 = d1 + timedelta(minutes=30)
        assert _date_proximity_score(d1, d2) == 1.0

    def test_31_min(self):
        d1 = datetime(2025, 1, 15, 10, 0, 0)
        d2 = d1 + timedelta(minutes=31)
        assert _date_proximity_score(d1, d2) == 0.9

    def test_within_2_hours(self):
        d1 = datetime(2025, 1, 15, 10, 0, 0)
        d2 = d1 + timedelta(hours=1, minutes=59)
        assert _date_proximity_score(d1, d2) == 0.9

    def test_within_4_hours(self):
        d1 = datetime(2025, 1, 15, 10, 0, 0)
        d2 = d1 + timedelta(hours=3)
        assert _date_proximity_score(d1, d2) == 0.7

    def test_within_6_hours(self):
        d1 = datetime(2025, 1, 15, 10, 0, 0)
        d2 = d1 + timedelta(hours=5)
        assert _date_proximity_score(d1, d2) == 0.5

    def test_same_day_late(self):
        d1 = datetime(2025, 1, 15, 2, 0, 0)
        d2 = datetime(2025, 1, 15, 23, 0, 0)
        assert _date_proximity_score(d1, d2) == 0.3

    def test_different_day(self):
        d1 = datetime(2025, 1, 15, 10, 0, 0)
        d2 = datetime(2025, 1, 16, 10, 0, 0)
        assert _date_proximity_score(d1, d2) == 0.0


class TestSportTypeScore:
    def test_exact_match(self):
        assert _sport_type_score("cycling", "cycling") == 1.0

    def test_compatible_types(self):
        # cycling and virtual_cycling should be compatible
        assert _sport_type_score("cycling", "virtual_cycling") == 0.5

    def test_incompatible_types(self):
        assert _sport_type_score("cycling", "running") == 0.0

    def test_unknown_type_exact(self):
        assert _sport_type_score("kayaking", "kayaking") == 1.0

    def test_unknown_type_mismatch(self):
        assert _sport_type_score("kayaking", "cycling") == 0.0


class TestDurationScore:
    def test_identical(self):
        assert _duration_score(3600, 3600) == 1.0

    def test_similar(self):
        assert _duration_score(3600, 3500) == pytest.approx(3500 / 3600, abs=0.01)

    def test_very_different(self):
        assert _duration_score(3600, 1800) == pytest.approx(0.5)

    def test_missing_data(self):
        assert _duration_score(None, 3600) == 0.5
        assert _duration_score(3600, None) == 0.5
        assert _duration_score(None, None) == 0.5

    def test_zero_duration(self):
        assert _duration_score(0, 3600) == 0.5


class TestDistanceScore:
    def test_identical(self):
        assert _distance_score(10000.0, 10000.0) == 1.0

    def test_similar(self):
        assert _distance_score(10000.0, 9500.0) == pytest.approx(0.95, abs=0.01)

    def test_missing_data(self):
        assert _distance_score(None, 10000.0) == 0.5
        assert _distance_score(0, 10000.0) == 0.5
