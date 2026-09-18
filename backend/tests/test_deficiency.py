"""Tests for deficiency service pure-function logic (no DB required)."""

import pytest

from app.services.deficiency import (
    _big3_ratio_advice,
    classify_ftp_absolute,
    classify_ftp_wkg,
    classify_push_pull,
    evaluate_big3_ratios,
    evaluate_push_pull_ratio,
    level_for_ratio,
    next_level_target,
    severity_for_level,
)

# ── Strength standards ───────────────────────────────────────────────────────


class TestStrengthStandards:
    def test_beginner_when_below_first_threshold(self):
        assert level_for_ratio("Back Squat", 0.9) == "beginner"

    @pytest.mark.parametrize(
        ("lift", "ratio", "expected"),
        [
            # Squat: 1.0 / 1.5 / 2.0 / 2.5
            ("Back Squat", 1.0, "beginner"),
            ("Back Squat", 1.5, "intermediate"),
            ("Back Squat", 2.4, "advanced"),
            ("Back Squat", 2.5, "elite"),
            # Bench: 0.6 / 1.0 / 1.4 / 1.8
            ("Bench Press", 0.6, "beginner"),
            ("Bench Press", 1.39, "intermediate"),
            ("Bench Press", 1.4, "advanced"),
            # Deadlift: 1.2 / 1.75 / 2.4 / 3.0
            ("Deadlift", 1.19, "beginner"),
            ("Deadlift", 1.75, "intermediate"),
            ("Deadlift", 2.4, "advanced"),
            ("Deadlift", 3.2, "elite"),
        ],
    )
    def test_level_boundaries(self, lift, ratio, expected):
        assert level_for_ratio(lift, ratio) == expected

    def test_next_level_target(self):
        assert next_level_target("Back Squat", "beginner") == pytest.approx(1.5)
        assert next_level_target("Deadlift", "intermediate") == pytest.approx(2.4)
        assert next_level_target("Bench Press", "elite") is None

    def test_severity_for_level(self):
        assert severity_for_level("beginner") == "high"
        assert severity_for_level("intermediate") == "medium"
        assert severity_for_level("advanced") == "low"
        assert severity_for_level("elite") == "low"


# ── Big-3 ratios ─────────────────────────────────────────────────────────────


class TestBig3Ratios:
    @staticmethod
    def _as_dict(ratios):
        return {metric: (value, severity) for metric, value, severity in ratios}

    def test_balanced_ratios_emit_nothing(self):
        # squat 140, bench 100, deadlift 170 → ratios 0.714 / 1.214 / 0.714...
        issues = evaluate_big3_ratios(squat=140, bench=98, deadlift=168)
        assert issues == []

    def test_low_bench_squat_critical(self):
        issues = self._as_dict(evaluate_big3_ratios(150, 70, 180))
        value, sev = issues["bench_squat_ratio"]
        assert value < 0.55
        assert sev == "critical"

    def test_slightly_low_bench_squat_medium(self):
        issues = self._as_dict(evaluate_big3_ratios(150, 92, 180))
        _, sev = issues["bench_squat_ratio"]
        assert sev == "medium"  # 0.61 — below ideal but not critical

    def test_bench_dominant_high(self):
        issues = self._as_dict(evaluate_big3_ratios(120, 110, 150))
        value, sev = issues["bench_squat_ratio"]
        assert value > 0.85
        assert sev == "high"

    def test_deadlift_squat_out_of_range_both_directions(self):
        low = self._as_dict(evaluate_big3_ratios(140, 90, 130))
        high = self._as_dict(evaluate_big3_ratios(120, 80, 200))
        assert low["deadlift_squat_ratio"][1] == "medium"
        assert high["deadlift_squat_ratio"][1] == "medium"
        assert low["deadlift_squat_ratio"][0] < 1.0
        assert high["deadlift_squat_ratio"][0] > 1.35

    def test_bench_deadlift_ratio_bounds(self):
        low = self._as_dict(evaluate_big3_ratios(140, 55, 160))
        high = self._as_dict(evaluate_big3_ratios(140, 115, 150))
        assert low["bench_deadlift_ratio"][1] == "medium"
        assert high["bench_deadlift_ratio"][1] == "medium"


class TestBig3RatioAdvice:
    """Advice direction follows each metric's own bounds, not 1."""

    def test_bench_deadlift_above_ideal_advises_hinge(self):
        # 115/150 = 0.767 — above ideal (0.45–0.75) yet below 1.
        detail, recommendation = _big3_ratio_advice("bench_deadlift_ratio", 0.767)
        assert "0.77" in detail
        assert recommendation == "Deadlift lags relative to bench — add hinge volume"

    def test_bench_deadlift_below_ideal_advises_press(self):
        detail, recommendation = _big3_ratio_advice("bench_deadlift_ratio", 0.34)
        assert recommendation == "Bench lags relative to deadlift — add pressing volume"

    def test_bench_squat_dominant_advises_squat(self):
        # 110/120 = 0.917 — above ideal yet below 1.
        _, recommendation = _big3_ratio_advice("bench_squat_ratio", 0.917)
        assert recommendation == "Bench dominant — balance with more squat frequency"

    def test_deadlift_squat_weak_advises_hinge(self):
        _, recommendation = _big3_ratio_advice("deadlift_squat_ratio", 0.93)
        assert recommendation == "Weak deadlift relative to squat — add hinge volume"


# ── Push/pull classification and balance ─────────────────────────────────────


class TestPushPullClassification:
    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("Bench Press", "push"),
            ("Overhead Press", "push"),
            ("Tricep Pushdown", "push"),  # contains "tricep"
            ("Cable Fly", "push"),
            ("Dip", "push"),
            ("Barbell Row", "pull"),
            ("Lat Pulldown", "pull"),
            ("Face Pull", "pull"),
            ("Hammer Curl", "pull"),
            ("Shrug", "pull"),
            ("Back Squat", None),
            ("Plank", None),
        ],
    )
    def test_classification(self, name, expected):
        assert classify_push_pull(name) == expected

    def test_balance_in_range_returns_none(self):
        assert evaluate_push_pull_ratio(10000, 9000) is None

    def test_pushing_deficit_high(self):
        """0.5 push/pull = pull-dominant → pushing deficit (not pulling)."""
        result = evaluate_push_pull_ratio(5000, 10000)
        assert result is not None
        assert result["severity"] == "high"
        assert result["value"] == pytest.approx(0.5)
        assert "pushing deficit" in result["detail"]

    def test_moderate_imbalance_severities(self):
        r = evaluate_push_pull_ratio(6000, 10000)  # 0.6 → high (pushing deficit)
        assert r["severity"] == "high"
        r = evaluate_push_pull_ratio(8000, 10000)  # 0.8 → medium
        assert r["severity"] == "medium"
        r = evaluate_push_pull_ratio(14000, 10000)  # 1.4 → low (push dominant)
        assert r["severity"] == "low"
        r = evaluate_push_pull_ratio(18000, 10000)  # 1.8 → medium
        assert r["severity"] == "medium"

    def test_push_deficit_recommends_pressing_not_pulling(self):
        """Ratio < 1 means more pulling than pushing — advice must add press."""
        r = evaluate_push_pull_ratio(8000, 10000)  # 0.8, pushing deficit
        assert "pressing" in r["recommendation"]
        assert "pulling" not in r["recommendation"]

    def test_push_dominant_recommends_pulling(self):
        """Ratio > 1.3 means push-dominant — advice must add pulls."""
        r = evaluate_push_pull_ratio(14000, 10000)  # 1.4
        assert "pull" in r["recommendation"].lower()

    def test_one_sided_volume_flags_high(self):
        """A missing movement pattern is an imbalance, not 'no data'."""
        r = evaluate_push_pull_ratio(0, 10000)
        assert r is not None
        assert r["severity"] == "high"
        assert r["value"] is None
        r = evaluate_push_pull_ratio(10000, 0)
        assert r is not None
        assert r["severity"] == "high"
        assert r["value"] is None

    def test_no_volume_returns_none(self):
        assert evaluate_push_pull_ratio(0, 0) is None


# ── FTP classification ───────────────────────────────────────────────────────


class TestFtpClassification:
    @pytest.mark.parametrize(
        ("wkg", "expected"),
        [
            (2.0, "poor"),
            (2.5, "average"),
            (3.1, "average"),
            (3.2, "good"),
            (3.99, "good"),
            (4.2, "excellent"),
        ],
    )
    def test_wkg_classes(self, wkg, expected):
        label, _ = classify_ftp_wkg(wkg)
        assert label == expected

    def test_absolute_fallback(self):
        assert classify_ftp_absolute(180)[0] == "average"
        assert classify_ftp_absolute(220)[0] == "good"
        assert classify_ftp_absolute(280)[0] == "excellent"
