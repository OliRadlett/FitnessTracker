"""Unit tests for the Wahoo plan.json builder (pure, no DB/network)."""

import pytest

from app.services.wahoo_plan_file import build_plan_json, zone_if_band


def _build(**overrides):
    kwargs = {
        "name": "Threshold Ride",
        "description": "3x20",
        "duration_min": 100,
        "zone": "z4",
        "power_watts": None,
        "ftp": 250.0,
        "workout_type_location": 1,
    }
    kwargs.update(overrides)
    return build_plan_json(**kwargs)


def test_returns_none_without_ftp():
    assert _build(ftp=None) is None
    assert _build(ftp=0) is None


def test_zone_if_band():
    assert zone_if_band("z4") == (0.90, 1.05)
    assert zone_if_band("Z2") == (0.55, 0.75)
    assert zone_if_band(None) is None
    assert zone_if_band("nope") is None


def test_header_and_intervals():
    plan = _build()
    header = plan["header"]
    assert header["ftp"] == 250
    assert header["workout_type_family"] == 0  # BIKING
    assert header["workout_type_location"] == 1
    assert header["duration_s"] == 6000

    intervals = plan["intervals"]
    assert len(intervals) == 3
    assert [i["intensity_type"] for i in intervals] == ["wu", "active", "cd"]
    assert sum(i["exit_trigger_value"] for i in intervals) == 6000


def test_power_target_is_first():
    plan = _build()
    for interval in plan["intervals"]:
        assert interval["targets"][0]["type"] == "ftp"


def test_main_interval_uses_zone_band():
    main = _build()["intervals"][1]
    assert main["exit_trigger_value"] == round(6000 * 0.8)
    assert main["targets"][0]["low"] == pytest.approx(0.90)
    assert main["targets"][0]["high"] == pytest.approx(1.05)


def test_power_derived_band_when_no_zone():
    main = _build(zone=None, power_watts=200)["intervals"][1]
    # 200/250 = 0.8 IF ± 0.05
    assert main["targets"][0]["low"] == pytest.approx(0.75)
    assert main["targets"][0]["high"] == pytest.approx(0.85)


def test_short_duration_minimum_interval():
    plan = _build(duration_min=1)
    assert all(i["exit_trigger_value"] >= 60 for i in plan["intervals"])
    # Total is recomputed after clamping so duration_s stays consistent.
    assert plan["header"]["duration_s"] == sum(
        i["exit_trigger_value"] for i in plan["intervals"]
    )


def test_no_target_falls_back_to_endurance():
    main = _build(zone=None, power_watts=None)["intervals"][1]
    assert main["targets"][0]["low"] == pytest.approx(0.55)
    assert main["targets"][0]["high"] == pytest.approx(0.75)
