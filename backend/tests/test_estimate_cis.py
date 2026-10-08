"""Numeric confidence intervals on flagship estimates (F9).

VO2max and FTP report approximate 95% cross-method-spread intervals
(``blend_ci_95``); TSB projections report adherence-sensitivity bands.
"""

from datetime import date, timedelta

import pytest

from app.services.cycling.power_curve import (
    blend_ci_95,
    estimate_ftp_from_power_curve_detailed,
)
from app.services.projections import tsb_projection

# Sprint-anchored curve resembling a real rider (mirrors test_power_model_fit).
DURATIONS = [5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 2700, 3600, 5400, 7200]
POWERS = [900, 820, 770, 530, 480, 300, 260, 230, 210, 200, 190, 185, 180, 175]


class TestBlendCi95:
    def test_single_value_has_no_interval(self):
        assert blend_ci_95([250.0]) is None
        assert blend_ci_95([]) is None

    def test_interval_contains_center_and_all_values(self):
        ci = blend_ci_95([200.0, 210.0, 220.0])
        assert ci is not None
        low, high = ci
        assert low <= 210.0 <= high
        assert low <= 200.0 and high >= 220.0

    def test_identical_values_collapse(self):
        assert blend_ci_95([200.0, 200.0, 200.0]) == (200.0, 200.0)

    def test_custom_center_still_contains_point(self):
        # VO2max centres on the best-confidence pick, not the mean.
        ci = blend_ci_95([40.0, 44.0, 48.0], center=48.0)
        assert ci is not None
        assert ci[0] <= 48.0 <= ci[1]
        assert ci[0] <= 40.0


class TestFtpCi:
    def test_full_curve_reports_containing_interval(self):
        curve = dict(zip(DURATIONS, POWERS))
        result = estimate_ftp_from_power_curve_detailed(curve)
        assert result is not None
        assert result.ci_low is not None and result.ci_high is not None
        assert result.ci_low <= result.ftp <= result.ci_high
        # Sanity: the interval is informative, not absurdly wide.
        assert result.ci_high - result.ci_low < result.ftp

    def test_single_method_reports_no_interval(self):
        # Only a 20-min best: Riegel 20-min is gated out (0.6 < 1.0 - 0.3),
        # so the blend has one method and the spread is unquantifiable.
        result = estimate_ftp_from_power_curve_detailed({1200: 210.0})
        assert result is not None
        assert result.ftp == pytest.approx(210.0 * 0.95)
        assert result.ci_low is None and result.ci_high is None


class TestTsbBands:
    def _planned(self, n, tss):
        d0 = date(2026, 1, 1)
        return [(d0 + timedelta(days=i), tss) for i in range(n)]

    def test_bands_bracket_point_every_day(self):
        planned = [(date(2026, 1, 1) + timedelta(days=i), 60.0 + i * 5) for i in range(14)]
        result = tsb_projection(50.0, 40.0, planned)
        assert len(result) == 14
        for point in result:
            assert point["tsb_low"] <= point["tsb"] <= point["tsb_high"]

    def test_bands_widen_with_horizon_on_loaded_plan(self):
        planned = self._planned(14, 80.0)
        result = tsb_projection(50.0, 40.0, planned)
        widths = [p["tsb_high"] - p["tsb_low"] for p in result]
        assert widths[0] >= 0
        assert widths[-1] > widths[0]

    def test_bands_collapse_on_all_rest(self):
        # Scaling zero training is still zero: no execution drift possible.
        planned = self._planned(7, 0.0)
        result = tsb_projection(60.0, 80.0, planned)
        for point in result:
            assert point["tsb_low"] == point["tsb"] == point["tsb_high"]

    def test_point_trajectory_unchanged_by_bands(self):
        # The central trajectory is the same run as before F9 (band=±20%
        # scenarios only add tsb_low/tsb_high keys).
        planned = self._planned(5, 70.0)
        result = tsb_projection(50.0, 50.0, planned)
        assert result[0]["ctl"] > 50.0
        for point in result:
            assert point["tsb"] == pytest.approx(
                point["ctl"] - point["atl"], abs=0.11
            )

    def test_custom_band_changes_width(self):
        planned = self._planned(10, 80.0)
        narrow = tsb_projection(50.0, 40.0, planned, adherence_band=0.1)
        wide = tsb_projection(50.0, 40.0, planned, adherence_band=0.3)
        assert (wide[-1]["tsb_high"] - wide[-1]["tsb_low"]) > (
            narrow[-1]["tsb_high"] - narrow[-1]["tsb_low"]
        )
