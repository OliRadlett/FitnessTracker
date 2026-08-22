"""Tests for health analysis service — pure scoring functions."""

from dataclasses import dataclass

from app.services.health_analysis import (
    _hrv_trend_signal,
    _recovery_signal,
    _rest_day_signal,
    _sleep_efficiency_signal,
    _tsb_signal,
    _unexplained_fatigue_signal,
    _volume_spike_signal,
)


# Minimal stub for SleepLog used by _sleep_efficiency_signal
@dataclass
class _FakeSleepLog:
    sleep_efficiency: float | None


class TestTsbSignal:
    """TSB signal: score based on consecutive negative TSB days."""

    def test_empty_returns_zero(self):
        assert _tsb_signal([]) == 0.0

    def test_positive_tsb_returns_zero(self):
        assert _tsb_signal([10, 5, 20]) == 0.0

    def test_one_negative_day(self):
        assert _tsb_signal([-40]) == 40.0

    def test_three_consecutive_negative(self):
        assert _tsb_signal([-40, -36, -50]) == 70.0

    def test_five_consecutive_negative(self):
        assert _tsb_signal([-40, -36, -50, -45, -38]) == 100.0

    def test_mixed_resets_count(self):
        """Positive day resets the consecutive count."""
        assert _tsb_signal([-40, -36, 5, -50]) == 40.0


class TestRecoverySignal:
    """Recovery signal: consecutive low recovery + absolute severity."""

    def test_empty_returns_zero(self):
        assert _recovery_signal([]) == 0.0

    def test_all_none_returns_zero(self):
        assert _recovery_signal([None, None]) == 0.0

    def test_healthy_recovery_returns_zero(self):
        assert _recovery_signal([80, 75, 90]) == 0.0

    def test_very_low_recovery(self):
        """Absolute severity: < 15% → 100."""
        assert _recovery_signal([10]) == 100.0

    def test_low_recovery(self):
        """< 25% → 70."""
        assert _recovery_signal([20]) == 70.0

    def test_four_consecutive_below_40(self):
        assert _recovery_signal([35, 30, 38, 25]) == 100.0

    def test_three_consecutive_below_40(self):
        assert _recovery_signal([35, 30, 38]) == 70.0


class TestVolumeSpikeSignal:
    """Volume spike: percentage increase over prior weeks (EWMA).

    Uses EWMA with 4-week half-life. Need enough prior weeks for
    EWMA to converge close to the steady-state value.
    """

    # 20 prior weeks at 100 → EWMA ≈ 99.2
    _PRIOR_20x100 = [100] * 20
    _ALL_ACTIVE_20 = [True] * 20

    def test_no_spike(self):
        """Current volume close to EWMA → 0."""
        assert _volume_spike_signal(100, self._PRIOR_20x100, self._ALL_ACTIVE_20) == 0.0

    def test_moderate_spike(self):
        """~26% increase over EWMA → 40."""
        assert (
            _volume_spike_signal(125, self._PRIOR_20x100, self._ALL_ACTIVE_20) == 40.0
        )

    def test_large_spike(self):
        """~41% increase over EWMA → 70."""
        assert (
            _volume_spike_signal(140, self._PRIOR_20x100, self._ALL_ACTIVE_20) == 70.0
        )

    def test_extreme_spike(self):
        """>50% increase over EWMA → 100."""
        assert (
            _volume_spike_signal(160, self._PRIOR_20x100, self._ALL_ACTIVE_20) == 100.0
        )

    def test_zero_baseline_returns_zero(self):
        """All prior weeks inactive → gate blocks signal."""
        assert (
            _volume_spike_signal(100, [0, 0, 0, 0], [False, False, False, False]) == 0.0
        )

    def test_insufficient_active_weeks(self):
        """Fewer than 2 active prior weeks → 0."""
        assert (
            _volume_spike_signal(200, [100, 100, 100, 100], [True, False, False, False])
            == 0.0
        )


class TestRestDaySignal:
    """Rest day signal: consecutive training days without rest."""

    def test_zero_days(self):
        assert _rest_day_signal(0) == 0.0

    def test_normal_training(self):
        assert _rest_day_signal(3) == 0.0

    def test_four_days(self):
        assert _rest_day_signal(4) == 40.0

    def test_five_days(self):
        assert _rest_day_signal(5) == 70.0

    def test_six_days(self):
        assert _rest_day_signal(6) == 70.0

    def test_seven_days(self):
        assert _rest_day_signal(7) == 100.0

    def test_ten_plus_days(self):
        assert _rest_day_signal(10) == 100.0


class TestHrvTrendSignal:
    """HRV trend: declining HRV over 7 days."""

    def test_empty_returns_zero(self):
        assert _hrv_trend_signal([]) == 0.0

    def test_stable_hrv(self):
        assert _hrv_trend_signal([50, 50, 50, 50, 50, 50, 50]) == 0.0

    def test_mild_decline(self):
        """~12% decline → 40.  Prior avg = (50+48+46+44+43+42)/6 = 45.5, recent=40 → 12.1%."""
        assert _hrv_trend_signal([50, 48, 46, 44, 43, 42, 40]) == 40.0

    def test_severe_decline(self):
        """15-20% decline → 70.  Prior avg = (50+45+40+38+36+35)/6 = 40.67, recent=33 → 18.9%."""
        assert _hrv_trend_signal([50, 45, 40, 38, 36, 35, 33]) == 70.0

    def test_too_few_points(self):
        """Fewer than 3 data points → 0."""
        assert _hrv_trend_signal([50, 40]) == 0.0


class TestSleepEfficiencySignal:
    """Sleep efficiency: declining sleep quality using EWMA."""

    def test_empty_returns_zero(self):
        assert _sleep_efficiency_signal([]) == 0.0

    def test_good_sleep(self):
        logs = [_FakeSleepLog(90), _FakeSleepLog(88), _FakeSleepLog(92)]
        assert _sleep_efficiency_signal(logs) == 0.0

    def test_poor_sleep(self):
        """EWMA < 83 → 40.  Single value 80 → EWMA = 80."""
        logs = [_FakeSleepLog(80)]
        assert _sleep_efficiency_signal(logs) == 40.0

    def test_very_poor_sleep(self):
        """EWMA < 78 → 70.  Single value 75 → EWMA = 75."""
        logs = [_FakeSleepLog(75)]
        assert _sleep_efficiency_signal(logs) == 70.0

    def test_terrible_sleep(self):
        """EWMA < 70 → 100.  Single value 65 → EWMA = 65."""
        logs = [_FakeSleepLog(65)]
        assert _sleep_efficiency_signal(logs) == 100.0

    def test_none_efficiency_skipped(self):
        logs = [_FakeSleepLog(None), _FakeSleepLog(90)]
        assert _sleep_efficiency_signal(logs) == 0.0


class TestUnexplainedFatigueSignal:
    """Unexplained fatigue: low recovery without meaningful training."""

    def test_no_data(self):
        """Empty recovery list → 0."""
        assert _unexplained_fatigue_signal([], 0) == 0.0

    def test_all_none(self):
        """All None values → 0."""
        assert _unexplained_fatigue_signal([None, None], 0) == 0.0

    def test_low_recovery_no_training(self):
        """Recovery < 45 and no meaningful training → 70."""
        assert _unexplained_fatigue_signal([50, 40], 0) == 70.0

    def test_very_low_recovery_no_training(self):
        """Recovery < 35 and no meaningful training → 100."""
        assert _unexplained_fatigue_signal([50, 30], 0) == 100.0

    def test_low_recovery_with_training(self):
        """Low recovery but has meaningful training → 0 (explained fatigue)."""
        assert _unexplained_fatigue_signal([50, 30], 3) == 0.0

    def test_healthy_recovery(self):
        """Healthy recovery → 0 regardless of training."""
        assert _unexplained_fatigue_signal([80, 75], 0) == 0.0
