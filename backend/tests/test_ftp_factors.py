"""F4/F5/F6/F8 guards: FTP factors, FRIEND-on-8min, norm scopes, log-linear interp.

- F4: 8-min × 0.90 (Allen/Coggan; was 0.855 via double-discount), 30-min
  × 0.97 (log-duration interpolation between anchored 20-min/60-min
  points), invented 10-min tier removed (Riegel path remains).
- F5: FRIEND applied to 8-min power only after Riegel scaling to the
  5-min equivalent, at confidence 0.5 with a transparent method string.
- F6: VO2 classes and power norms carry age/sex scope labels.
- F8: ``percentile_wkg_at`` interpolates log-linearly in duration.
"""

from __future__ import annotations

import pytest

from app.services.cycling.power_curve import (
    estimate_ftp_from_power_curve,
    estimate_ftp_from_power_curve_detailed,
)


class TestFtpFactors:
    def test_20min_gold_standard(self):
        assert estimate_ftp_from_power_curve({1200: 200.0}) == pytest.approx(
            190.0, abs=2.0
        )

    def test_60min_direct(self):
        assert estimate_ftp_from_power_curve({3600: 250.0}) == pytest.approx(
            250.0, abs=1.0
        )

    def test_8min_uses_literature_factor_0_90(self):
        """F4: 300W 8-min → 270W, not the old 256.5W (0.855)."""
        detailed = estimate_ftp_from_power_curve_detailed({480: 300.0})
        assert detailed is not None
        assert detailed.method == "8-min × 0.90"
        assert detailed.ftp == pytest.approx(270.0, abs=1.0)
        assert "0.855" not in detailed.method

    def test_30min_factor_0_97(self):
        """F4: 300W 30-min → 291W (was 285W via invented × 0.95)."""
        detailed = estimate_ftp_from_power_curve_detailed({1800: 300.0})
        assert detailed is not None
        assert detailed.method == "30-min × 0.97"
        assert detailed.ftp == pytest.approx(291.0, abs=1.0)

    def test_10min_tier_removed_but_riegel_remains(self):
        """F4: no invented 10-min factor tier; 10-min bests contribute
        only via the documented Riegel extrapolation."""
        detailed = estimate_ftp_from_power_curve_detailed({600: 340.0})
        assert detailed is not None
        methods = [e["method"] for e in detailed.all_estimates]
        assert not any(m.startswith("10-min ×") for m in methods)
        assert any("Riegel" in m for m in methods)

    def test_5min_factor_unchanged(self):
        detailed = estimate_ftp_from_power_curve_detailed({300: 350.0})
        assert detailed is not None
        assert detailed.ftp == pytest.approx(297.5, abs=5.0)
        assert detailed.confidence <= 0.5

    def test_rich_curve_still_anchored_on_20min(self):
        detailed = estimate_ftp_from_power_curve_detailed(
            {300: 380.0, 600: 340.0, 1200: 310.0, 1800: 300.0, 3600: 285.0}
        )
        assert detailed is not None
        assert detailed.method == "20-min × 0.95"
        assert detailed.ftp == pytest.approx(294.5, abs=8.0)
        assert detailed.confidence < 1.0


class TestFriendOn8Min:
    """F5: 8-min power reaches FRIEND only via Riegel scaling (DB stubbed)."""

    @staticmethod
    def _run_estimate(monkeypatch, curve, weight_kg=75.0):
        import app.services.cycling.power_curve as pc_mod
        import app.services.cycling.training_load as tl_mod
        import app.services.cycling.vo2max as vo2_mod

        async def _fake_curve(db, user_id, days=90):
            return dict(curve)

        class _Profile:
            def __init__(self, w):
                self.weight_kg = w

        async def _fake_profile(db, user_id):
            return _Profile(weight_kg)

        class _FakeResult:
            def scalar(self):
                return None

            def scalar_one_or_none(self):
                return None

        class _FakeDB:
            async def execute(self, *args, **kwargs):
                return _FakeResult()

        monkeypatch.setattr(
            pc_mod, "compute_power_curve_from_streams", _fake_curve
        )
        monkeypatch.setattr(tl_mod, "get_or_create_cycling_profile", _fake_profile)
        import asyncio

        return asyncio.run(vo2_mod.estimate_vo2max(_FakeDB(), None))

    def test_lone_8min_is_scaled_not_direct(self, monkeypatch):
        est = self._run_estimate(monkeypatch, {480: 300.0})
        assert est is not None
        # 300W × (480/300)^0.06 ≈ 308.6W equiv → FRIEND ≈ 47.3 ml/kg/min.
        # Direct (uncalibrated) application would read ≈ 46.1.
        assert est.vo2max == pytest.approx(47.3, abs=0.5)
        assert est.vo2max > 46.5, "must not be the unscaled 8-min read"
        assert est.confidence == 0.5
        assert "scaled" in est.method and "Riegel" in est.method
        assert len(est.all_estimates) == 1

    def test_5min_still_preferred_over_scaled_8min(self, monkeypatch):
        est = self._run_estimate(monkeypatch, {300: 320.0, 480: 300.0})
        assert est is not None
        assert est.confidence == 0.7
        assert "5-min" in est.method


class TestNormScopes:
    """F6: scope labels travel with the norms."""

    def test_vo2_scope_names_age_sex_limitation(self):
        from app.services.cycling.vo2max import VO2_CLASS_SCOPE

        lowered = VO2_CLASS_SCOPE.lower()
        assert "age" in lowered and "sex" in lowered
        assert "general" in lowered

    def test_power_profile_scope_names_male_limitation(self):
        from app.services.cycling.power_profile import POWER_PROFILE_SCOPE

        lowered = POWER_PROFILE_SCOPE.lower()
        assert "male" in lowered
        assert "age" in lowered and "sex" in lowered

    def test_vo2_classification_labels_unchanged(self):
        from app.services.cycling.vo2max import _classify_vo2max

        assert _classify_vo2max(30.0) == "Poor"
        assert _classify_vo2max(50.0) == "Average"
        assert _classify_vo2max(80.0) == "Superior"


class TestLogLinearInterp:
    """F8: power-profile interpolation is log-linear in duration."""

    def test_exact_buckets_unchanged(self):
        from app.services.cycling.power_profile import percentile_wkg_at

        assert percentile_wkg_at(300, 50) == pytest.approx(4.0)
        assert percentile_wkg_at(1200, 50) == pytest.approx(3.3)

    def test_midpoint_is_log_linear_not_linear(self):
        from app.services.cycling.power_profile import percentile_wkg_at

        # 600s sits halfway between 300s and 1200s in ln(t) (frac = 0.5),
        # so p50 = (4.0 + 3.3) / 2 = 3.65. Linear-in-seconds would give 3.77.
        assert percentile_wkg_at(600, 50) == pytest.approx(3.65, abs=0.01)

    def test_clamping_at_ends(self):
        from app.services.cycling.power_profile import percentile_wkg_at

        assert percentile_wkg_at(1, 50) == pytest.approx(10.0)
        assert percentile_wkg_at(99999, 90) == pytest.approx(4.0)
