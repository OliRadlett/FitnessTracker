"""Time-aware windowing: a 30-second window is not 30 samples."""

import pytest

from app.services.cycling import timeaxis
from app.services.cycling.power_curve import best_power_rolling_average
from app.services.cycling.tss import compute_normalized_power


def test_normalized_power_is_constant_on_a_two_second_grid():
    time_s = [float(i * 2) for i in range(600)]
    power = [200.0] * len(time_s)
    assert timeaxis.normalized_power(time_s, power) == pytest.approx(200.0, abs=0.1)


def test_normalized_power_is_constant_on_a_one_hz_grid():
    time_s = [float(i) for i in range(1200)]
    power = [200.0] * len(time_s)
    assert timeaxis.normalized_power(time_s, power) == pytest.approx(200.0, abs=0.1)


def test_normalized_power_uses_seconds_not_samples():
    """Sixty seconds at 100 W then sixty at 300 W, sampled every 2 s.

    A 30-sample window spans 60 s and smooths the step; a 30-second window
    sees the 300 W block at full value.
    """
    time_s = [float(i * 2) for i in range(60)]
    power = [100.0] * 30 + [300.0] * 30
    time_aware = timeaxis.normalized_power(time_s, power)
    sample_count = 30
    rolling = [
        sum(power[i : i + sample_count]) / sample_count
        for i in range(len(power) - sample_count + 1)
    ]
    sample_based = (sum(v**4 for v in rolling) / len(rolling)) ** 0.25
    assert time_aware is not None
    assert time_aware > sample_based


def test_best_power_uses_the_time_axis():
    time_s = [float(i * 2) for i in range(600)]
    power = [200.0] * len(time_s)
    assert timeaxis.best_power(time_s, power, 300) == pytest.approx(200.0, abs=0.1)


def test_best_power_curve_matches_individual_buckets():
    time_s = [float(i * 2) for i in range(600)]
    power = [200.0] * len(time_s)
    curve = timeaxis.best_power_curve(time_s, power, [60, 300])
    assert curve[60] == pytest.approx(200.0, abs=0.1)
    assert curve[300] == pytest.approx(200.0, abs=0.1)


def test_zone_seconds_use_real_sample_duration():
    """Five minutes at 200 W on a 2 s grid is 300 seconds in Z3 (0.8 FTP)."""
    time_s = [float(i * 2) for i in range(151)]
    power = [200.0] * len(time_s)
    zones = [
        ("Z1", "Recovery", 0.0, 0.55),
        ("Z2", "Endurance", 0.55, 0.75),
        ("Z3", "Tempo", 0.75, 0.90),
        ("Z4", "Threshold", 0.90, 1.05),
    ]
    seconds = timeaxis.zone_seconds(power, time_s, 250.0, zones)
    # 151 samples at 2 s each: the same convention as the old sample count,
    # but measured in seconds rather than assumed to be one second per sample.
    assert seconds["Z3"] == pytest.approx(302.0, abs=1.0)
    assert seconds["Z1"] == 0.0


def test_zone_seconds_cap_a_stop():
    """A 10 s gap is capped at MAX_GAP_S, not counted as 10 s of zone time."""
    time_s = [0.0, 1.0, 11.0, 12.0]
    power = [200.0, 200.0, 200.0, 200.0]
    zones = [("Z3", "Tempo", 0.75, 0.90)]
    seconds = timeaxis.zone_seconds(power, time_s, 250.0, zones)
    assert seconds["Z3"] == pytest.approx(3.0, abs=0.1)


def test_one_hz_np_matches_the_sample_based_path():
    time_s = [float(i) for i in range(600)]
    power = [200.0 + (i % 7) * 10 for i in range(600)]
    assert timeaxis.normalized_power(time_s, power) == pytest.approx(
        compute_normalized_power(power), abs=0.1
    )


def test_one_hz_best_power_matches_the_sample_based_path():
    time_s = [float(i) for i in range(600)]
    power = [200.0 + (i % 7) * 10 for i in range(600)]
    assert timeaxis.best_power(time_s, power, 300) == pytest.approx(
        best_power_rolling_average(power, 300), abs=0.1
    )


def test_short_streams_return_none():
    assert timeaxis.normalized_power([0.0, 1.0], [200.0, 200.0]) is None
    assert timeaxis.best_power([0.0, 1.0], [200.0, 200.0], 30) is None
