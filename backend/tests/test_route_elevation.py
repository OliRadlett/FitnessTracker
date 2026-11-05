"""Resampling an activity altitude stream onto a route profile."""

from app.services.route_elevation import resample_elevation


def test_ramp_with_distance_stream():
    profile = resample_elevation(
        altitudes=[100, 150, 200, 250],
        distances=[0, 1000, 2000, 3000],
        route_distance_m=3000,
        points=4,
    )

    assert profile is not None
    assert profile["distance"] == [0.0, 1000.0, 2000.0, 3000.0]
    assert profile["elevation"] == [100.0, 150.0, 200.0, 250.0]


def test_route_shorter_than_stream_scales_fractions():
    profile = resample_elevation(
        altitudes=[0, 100, 200, 300, 400],
        distances=[0, 250, 500, 750, 1000],
        route_distance_m=500,
        points=3,
    )

    assert profile["distance"] == [0.0, 250.0, 500.0]
    assert profile["elevation"] == [0.0, 200.0, 400.0]


def test_no_distance_stream_uses_uniform_spacing():
    profile = resample_elevation(
        altitudes=[10, 20, 30],
        distances=None,
        route_distance_m=2000,
        points=3,
    )

    assert profile["distance"] == [0.0, 1000.0, 2000.0]
    assert profile["elevation"] == [10.0, 20.0, 30.0]


def test_missing_values_are_skipped():
    profile = resample_elevation(
        altitudes=[10, None, 30, 40],
        distances=[0, 100, 200, 300],
        route_distance_m=300,
        points=3,
    )

    assert profile is not None
    assert all(value is not None for value in profile["elevation"])


def test_too_little_data_returns_none():
    assert resample_elevation([], None, 1000) is None
    assert resample_elevation([None, None], None, 1000) is None
    assert resample_elevation([100], None, 1000) is None
    assert resample_elevation([100, 200], None, 0) is None


def test_repeated_start_distances_do_not_divide_by_zero():
    profile = resample_elevation(
        altitudes=[50, 50, 60, 70],
        distances=[0, 0, 0, 100],
        route_distance_m=100,
        points=2,
    )

    assert profile is not None
    # Repeated start distances collapse to the last sample at that distance.
    assert profile["elevation"][0] == 60.0
