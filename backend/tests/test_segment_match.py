"""Synthetic geometry tests for the latlng matcher.

No database. The DP's job is to pick a monotonic path through a loop, so the
tests are: a clean traverse, a loop/out-and-back (the failure mode that killed
the summary-polyline matcher), a parallel-road rejection and direction.
"""

from __future__ import annotations

from app.services.segment_match import match_geometry


def _climb():
    return [[55.9000 + i * 0.0009, -3.2000] for i in range(11)]  # ~1 km north


def test_clean_traverse_is_matched():
    climb = _climb()
    ride = (
        [[55.8900 + i * 0.0005, -3.2000] for i in range(10)]
        + climb
        + [[55.9100 + i * 0.0005, -3.2000] for i in range(10)]
    )

    match = match_geometry(climb, ride)

    assert match is not None
    assert 950 <= match["span_m"] <= 1050
    assert match["median_offset"] <= 5
    assert match["p90_offset"] <= 10
    assert 0 < match["start_frac"] < match["end_frac"] < 1


def test_loop_picks_one_monotonic_pass_not_both():
    """The ride goes up the climb and back down the same road.

    Independent nearest-point projection snapped a middle point to the return
    pass and broke monotonicity. The DP must choose one pass end-to-end.
    """
    climb = _climb()
    ride = climb + list(reversed(climb))

    match = match_geometry(climb, ride)

    assert match is not None
    assert 950 <= match["span_m"] <= 1050
    assert match["median_offset"] <= 5


def test_parallel_road_is_rejected():
    climb = _climb()
    # ~190 m east: every climb point is outside the candidate radius.
    ride = [[lat, lng + 0.003] for lat, lng in climb]

    assert match_geometry(climb, ride) is None


def test_reverse_traverse_is_rejected():
    climb = _climb()
    ride = list(reversed(climb))

    assert match_geometry(climb, ride) is None
