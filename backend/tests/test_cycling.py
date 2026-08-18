"""Tests for cycling service — TSS, IF, VI, NP, VAM, FTP estimation."""

from datetime import date, timedelta

import pytest

from app.services.cycling import (
    calculate_intensity_factor,
    calculate_power_tss,
    calculate_vam,
    calculate_variability_index,
    compute_normalized_power,
    compute_training_load,
    estimate_ftp_from_power_curve,
)


class TestCalculatePowerTSS:
    """TSS = (duration_s × NP × IF) / (FTP × 3600) × 100."""

    def test_one_hour_at_ftp(self):
        """1 hour at FTP (IF=1.0) should give TSS=100."""
        tss = calculate_power_tss(3600, 250.0, 250.0)
        assert tss == pytest.approx(100.0, abs=0.1)

    def test_two_hours_at_ftp(self):
        """2 hours at FTP should give TSS=200."""
        tss = calculate_power_tss(7200, 250.0, 250.0)
        assert tss == pytest.approx(200.0, abs=0.1)

    def test_half_hour_easy(self):
        """30 min at IF=0.7 → TSS ≈ 24.5."""
        # IF = 175/250 = 0.7, TSS = (1800 × 175 × 0.7) / (250 × 3600) × 100
        tss = calculate_power_tss(1800, 175.0, 250.0)
        assert tss == pytest.approx(24.5, abs=0.1)

    def test_zero_ftp_returns_zero(self):
        assert calculate_power_tss(3600, 250.0, 0) == 0.0

    def test_zero_duration_returns_zero(self):
        assert calculate_power_tss(0, 250.0, 250.0) == 0.0

    def test_negative_values_return_zero(self):
        assert calculate_power_tss(3600, 250.0, -250.0) == 0.0
        assert calculate_power_tss(-3600, 250.0, 250.0) == 0.0


class TestCalculateIntensityFactor:
    def test_at_ftp(self):
        assert calculate_intensity_factor(250.0, 250.0) == pytest.approx(1.0)

    def test_easy_ride(self):
        assert calculate_intensity_factor(175.0, 250.0) == pytest.approx(0.7)

    def test_zero_ftp(self):
        assert calculate_intensity_factor(250.0, 0) is None

    def test_zero_np(self):
        assert calculate_intensity_factor(0, 250.0) is None


class TestCalculateVariabilityIndex:
    def test_steady_ride(self):
        """Steady ride: NP ≈ AP → VI ≈ 1.0."""
        assert calculate_variability_index(250.0, 250.0) == pytest.approx(1.0)

    def test_variable_ride(self):
        """Variable ride: NP > AP → VI > 1.0."""
        assert calculate_variability_index(280.0, 250.0) == pytest.approx(1.12)

    def test_zero_avg(self):
        assert calculate_variability_index(250.0, 0) is None


class TestComputeNormalizedPower:
    def test_constant_power(self):
        """Constant power should have NP ≈ that power."""
        power_data = [200.0] * 60
        np = compute_normalized_power(power_data)
        assert np == pytest.approx(200.0, abs=0.1)

    def test_too_few_data_points(self):
        """Less than 30 seconds of data → None."""
        assert compute_normalized_power([200.0] * 20) is None

    def test_empty_data(self):
        assert compute_normalized_power([]) is None

    def test_all_zeros(self):
        """All zeros → None (cleaned out)."""
        assert compute_normalized_power([0.0] * 60) is None

    def test_mixed_with_zeros(self):
        """Zeros filtered out; if < 30 remain → None."""
        data = [0.0] * 40 + [200.0] * 20
        assert compute_normalized_power(data) is None


class TestCalculateVAM:
    def test_normal(self):
        """1000m gain in 1 hour → 1000 VAM."""
        assert calculate_vam(1000.0, 3600) == pytest.approx(1000.0)

    def test_half_hour(self):
        """500m in 30 min → 1000 VAM."""
        assert calculate_vam(500.0, 1800) == pytest.approx(1000.0)

    def test_zero_duration(self):
        assert calculate_vam(1000.0, 0) is None

    def test_zero_elevation(self):
        assert calculate_vam(0.0, 3600) is None


class TestEstimateFTPFromPowerCurve:
    def test_20min_standard(self):
        """200W for 20 min → FTP ≈ 190W (200 × 0.95)."""
        ftp = estimate_ftp_from_power_curve({1200: 200.0})
        assert ftp == pytest.approx(190.0, abs=2.0)

    def test_60min_direct(self):
        """250W for 60 min → FTP ≈ 250W (direct)."""
        ftp = estimate_ftp_from_power_curve({3600: 250.0})
        assert ftp == pytest.approx(250.0, abs=1.0)

    def test_8min_fallback(self):
        """300W for 8 min → FTP ≈ 256.5W (300 × 0.90 × 0.95)."""
        ftp = estimate_ftp_from_power_curve({480: 300.0})
        assert ftp == pytest.approx(256.5, abs=1.0)

    def test_empty_curve(self):
        assert estimate_ftp_from_power_curve({}) is None

    def test_all_zeros(self):
        assert estimate_ftp_from_power_curve({1200: 0, 3600: 0}) is None

    def test_unreasonable_ftp_rejected(self):
        """FTP outside 50-600W range → None."""
        assert estimate_ftp_from_power_curve({1200: 5.0}) is None  # 5 × 0.95 = 4.75W
        assert estimate_ftp_from_power_curve({1200: 1000.0}) is None  # 950W

    def test_multiple_durations_weighted(self):
        """Multiple durations produce a weighted average."""
        curve = {1200: 200.0, 3600: 180.0, 480: 260.0}
        ftp = estimate_ftp_from_power_curve(curve)
        assert ftp is not None
        assert 150 < ftp < 220  # Reasonable range


class TestComputeTrainingLoad:
    """CTL/ATL/TSB from daily TSS values."""

    def test_empty_tss(self):
        """Empty TSS → all zero values over the lookback period."""
        today = date.today()
        result = compute_training_load({}, end_date=today, lookback_days=7)
        assert len(result) == 8  # 7 days + end_date
        assert all(e["tss"] == 0.0 for e in result)
        assert all(e["ctl"] == pytest.approx(0.0, abs=0.01) for e in result)

    def test_single_day(self):
        """Single TSS value → TSS appears in result, CTL/ATL ramp up."""
        today = date.today()
        daily_tss = {today: 100.0}
        result = compute_training_load(daily_tss, end_date=today, lookback_days=1)
        assert len(result) == 2  # lookback day + today
        today_entry = result[-1]
        assert today_entry["tss"] == pytest.approx(100.0)
        # CTL and ATL should have ramped up from the single day
        assert today_entry["ctl"] > 0
        assert today_entry["atl"] > 0

    def test_steady_load_builds_ctl(self):
        """Consistent 100 TSS/day for 90 days → CTL approaches 100."""
        today = date.today()
        daily_tss = {}
        for i in range(90):
            d = today - timedelta(days=89 - i)
            daily_tss[d] = 100.0

        result = compute_training_load(daily_tss, end_date=today, lookback_days=90)
        last = result[-1]
        # CTL (42-day EWMA) should be approaching 100
        assert last["ctl"] > 80
        # ATL (7-day EWMA) should be close to 100
        assert last["atl"] > 90
