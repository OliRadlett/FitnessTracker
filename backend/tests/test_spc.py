"""Unit tests for SPC control limits (§3.18 / F5)."""

from app.services.spc import compute_control


def test_insufficient_history():
    out = compute_control([1.0, 2.0, 3.0])
    assert out["n"] == 3
    assert out["status"] == "insufficient"
    assert out["mean"] is None
    assert out["latest"] == 3.0


def test_normal_point_within_limits():
    out = compute_control([10.0, 11.0, 9.0, 10.0, 10.0, 10.5])
    assert out["n"] == 6
    assert out["status"] == "normal"
    assert out["mean"] == 10.083
    assert out["lcl"] < out["latest"] < out["ucl"]


def test_above_flag_when_latest_outside_upper_limit():
    out = compute_control([10.0, 10.0, 10.0, 10.0, 10.0, 99.0])
    assert out["status"] == "above"
    assert out["latest"] > out["ucl"]


def test_below_flag_when_latest_outside_lower_limit():
    out = compute_control([50.0, 51.0, 49.0, 50.0, 50.0, 5.0])
    assert out["status"] == "below"
    assert out["latest"] < out["lcl"]


def test_flat_series_is_normal_not_divide_by_zero():
    out = compute_control([7.0] * 6)
    assert out["status"] == "normal"
    assert out["sigma"] == 0.0
    assert out["z"] == 0.0


def test_none_values_ignored():
    out = compute_control([10.0, None, 10.0, 10.0, 10.0, 10.0])
    assert out["n"] == 5
