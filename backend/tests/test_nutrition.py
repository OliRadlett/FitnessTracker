"""Tests for ride fuel plan computation (pure functions, no DB)."""

import pytest

from app.services.nutrition import (
    _build_during_ride_schedule,
    compute_fuel_targets,
    estimate_intensity_factor,
)


class TestCarbTargets:
    @pytest.mark.parametrize(
        "duration_min,if_val,expected",
        [
            (45, 0.70, 0),  # short ride: no carbs
            (60, 0.60, 30),
            (90, 0.75, 40),
            (110, 0.90, 50),
            (150, 0.80, 60),
            (170, 0.65, 50),
            (200, 0.85, 80),
            (290, 0.95, 90),
            (360, 0.70, 80),
            (400, 1.00, 100),
        ],
    )
    def test_carbs_per_hour_matrix(self, duration_min, if_val, expected):
        assert compute_fuel_targets(duration_min, if_val, 75)["during_carbs_per_hour_g"] == expected

    def test_pre_ride_scales_with_weight(self):
        t = compute_fuel_targets(120, 0.75, 80)
        assert t["pre_ride_carbs_g"] == 120  # 1.5 g/kg
        assert t["post_ride_carbs_g"] == 96  # 1.2 g/kg
        assert t["post_ride_protein_g"] == 24  # 0.3 g/kg


class TestHydrationSodium:
    def test_base_values(self):
        t = compute_fuel_targets(90, 0.7, 75)
        assert t["during_hydration_ml_per_hour"] == 500
        assert t["during_sodium_mg_per_hour"] == 300

    def test_hard_long_ride_upgrades(self):
        t = compute_fuel_targets(240, 0.9, 75)
        # 500 + 100 (hard) + 150 (long)
        assert t["during_hydration_ml_per_hour"] == 750
        # 300 + 300 (long) + 150 (hard)
        assert t["during_sodium_mg_per_hour"] == 750


class TestSchedule:
    def test_short_ride_no_feeds(self):
        assert _build_during_ride_schedule(50, 30, 500, 300) == []

    def test_moderate_rate_uses_45min_interval(self):
        entries = _build_during_ride_schedule(150, 60, 500, 600)
        times = [e["time_min"] for e in entries]
        assert times == [45, 90, 135]  # last feed stops ~10 min before end
        for e in entries:
            assert e["carbs_g"] == 45
            assert e["hydration_ml"] == 375
            assert e["sodium_mg"] == 450
            assert e["suggestion"]

    def test_high_rate_uses_30min_interval(self):
        entries = _build_during_ride_schedule(180, 90, 700, 700)
        times = [e["time_min"] for e in entries]
        assert times[0] == 30
        assert all(e["carbs_g"] == 45 for e in entries)

    def test_long_ride_many_feeds(self):
        entries = _build_during_ride_schedule(360, 80, 650, 750)
        assert len(entries) >= 6


class TestIntensityFactorEstimation:
    def test_np_over_ftp_preferred(self):
        assert estimate_intensity_factor(210, 190, None, 250, 7200) == 0.84

    def test_ap_fallback(self):
        assert estimate_intensity_factor(None, 200, 999, 250, 7200) == 0.8

    def test_tss_derived(self):
        # TSS=150 over 1.5h -> IF = sqrt(150/150) = 1.0
        assert estimate_intensity_factor(None, None, 150, None, 5400) == 1.0

    def test_neutral_fallback(self):
        assert estimate_intensity_factor(None, None, None, None, None) == 0.75
