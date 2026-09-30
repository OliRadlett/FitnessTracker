"""The detour test — §4's second half, and the one that does not exist yet.

The spine test (``coverage()``) asks what *fraction* of a ride follows the
course. It cannot catch a ride that shares the first half and then leaves
for an hour: that ride scores ~0.5 coverage, which clears a lenient gate
while being a different ride entirely. The plan's §4 requires both tests,
and ``score_route_pair`` currently implements only the first.

The detour test asks the complementary question: the *longest continuous
run* of points that leave the course. A town detour is short and rejoins;
a different ride after a shared start is one long run that never comes
back. Measuring it as a distance rather than a point count matters,
because decimated polylines sample unevenly — a sparse region can be
long in metres but few in points.

The budget scales with course length (§4: 2 km *or* 10% of course length,
whichever is larger), because a 2 km detour on a 10 km loop is a different
ride and the same detour on a 100 km ride is noise.

These are pure functions over points, so the whole test suite here is
pure-function: no database, no network.
"""

from __future__ import annotations

import math

import pytest

from app.services.route_matching import (
    DEFAULT_DETOUR_KM,
    SPINE_MIN_COVERAGE,
    detour_budget_m,
    longest_uncovered_run_m,
    passes_detour_test,
    passes_spine_test,
    polyline_length,
)


def _line(lat0: float, lng0: float, lat1: float, lng1: float, n: int = 60):
    """A straight run of ``n`` points from (lat0,lng0) to (lat1,lng1)."""
    return [
        (lat0 + (lat1 - lat0) * i / (n - 1), lng0 + (lng1 - lng0) * i / (n - 1))
        for i in range(n)
    ]


def _offset_run(base, start_idx: int, length: int, dlng: float = 0.02):
    """A branch that leaves ``base`` for ``length`` points then rejoins.

    Offsets **longitude**, not latitude: the fixtures below run north, so
    a latitude offset slides the points *along* the line rather than away
    from it and the detour is never detected. That produced a green-looking
    fixture with a zero measured run.
    """
    out = list(base)
    for i in range(start_idx, min(start_idx + length, len(out))):
        out[i] = (out[i][0], out[i][1] + dlng)
    return out


class TestLongestUncoveredRun:
    def test_identical_lines_have_no_divergence(self):
        line = _line(55.94, -3.20, 55.96, -3.20)
        assert longest_uncovered_run_m(line, line, tol_m=50.0) == 0.0

    def test_short_town_detour_is_measured_not_ignored(self):
        base = _line(55.94, -3.20, 55.96, -3.20, n=120)
        ride = _offset_run(base, 50, 6)
        run = longest_uncovered_run_m(ride, base, tol_m=50.0)
        assert run > 0.0, "a detour must be detected, not silently accepted"

    def test_divergence_at_the_start_is_measured(self):
        """A ride that leaves immediately never rejoins — a long run."""
        base = _line(55.94, -3.20, 55.96, -3.20, n=120)
        ride = _offset_run(base, 0, 120)
        assert longest_uncovered_run_m(ride, base, tol_m=50.0) > 2000.0

    def test_two_short_detours_are_shorter_than_one_long_one(self):
        """The test is about the WORST single departure, not the total.

        This is what separates "detoured twice through town" (same
        course) from "detoured once and went somewhere else".
        """
        base = _line(55.94, -3.20, 55.96, -3.20, n=200)
        two_short = _offset_run(_offset_run(base, 20, 5), 120, 5)
        one_long = _offset_run(base, 20, 40)
        assert longest_uncovered_run_m(two_short, base, tol_m=50.0) < longest_uncovered_run_m(
            one_long, base, tol_m=50.0
        )

    def test_run_is_measured_in_metres_not_points(self):
        """A sparse long branch has few points but lots of metres.

        Decimated polylines sample unevenly, so a point count would
        under-report exactly the divergences that matter.
        """
        base = _line(55.94, -3.20, 55.96, -3.20, n=200)
        # Two points, ~2.2 km apart, both far from the course.
        sparse = list(base)
        sparse[100] = (55.950, -3.20)
        sparse[101] = (55.970, -3.20)
        assert longest_uncovered_run_m(sparse, base, tol_m=50.0) > 1000.0

    def test_empty_inputs_score_zero(self):
        assert longest_uncovered_run_m([], [], tol_m=50.0) == 0.0

    def test_point_beyond_both_ends_counts(self):
        base = _line(55.94, -3.20, 55.96, -3.20, n=60)
        ride = base + [(55.90, -3.20)] * 5
        assert longest_uncovered_run_m(ride, base, tol_m=50.0) > 0.0


class TestDetourBudget:
    def test_budget_is_the_larger_of_2km_and_10_percent(self):
        # 21.4 km course -> 2.14 km
        assert detour_budget_m(21_400.0) == pytest.approx(2_140.0)
        # 60 km course -> 6 km, the 10% term wins
        assert detour_budget_m(60_000.0) == pytest.approx(6_000.0)
        # 15 km course -> 1.5 km, so the 2 km floor wins
        assert detour_budget_m(15_000.0) == pytest.approx(2_000.0)

    def test_default_is_two_km(self):
        assert DEFAULT_DETOUR_KM == 2.0

    def test_zero_length_course_gets_the_floor(self):
        assert detour_budget_m(0.0) == pytest.approx(2_000.0)

    def test_tiny_course_does_not_get_a_zero_budget(self):
        """A 300 m course must not become free-form."""
        assert detour_budget_m(300.0) == pytest.approx(2_000.0)


class TestSpineTest:
    def test_identical_lines_pass(self):
        line = _line(55.94, -3.20, 55.96, -3.20)
        assert passes_spine_test(line, line) is True

    def test_half_shared_line_fails(self):
        """Shares the first half then leaves: the case coverage alone misses."""
        base = _line(55.94, -3.20, 55.96, -3.20, n=120)
        ride = _offset_run(base, 60, 60)
        assert passes_spine_test(ride, base) is False

    def test_ninety_percent_threshold_is_the_default(self):
        line = _line(55.94, -3.20, 55.96, -3.20)
        assert passes_spine_test(line, line, min_coverage=0.90) is True

    def test_empty_ride_fails(self):
        assert passes_spine_test([], _line(55.94, -3.20, 55.96, -3.20)) is False


class TestSpineThresholdCalibration:
    """The 0.90 default from §4 was calibrated down to 0.75 against data.

    Course 42de2b16 has 45 control rides (all definitely the same course)
    and one known outlier. Measured as best-of-5 reference traces:

        coverage >= 0.90  keeps 35/45 controls  — 10 real rides rejected
        coverage >= 0.75  keeps 45/45 controls, rejects the outlier (0.593)

    Rejecting a genuine ride is the worse failure: it strands a real
    course member, which is harder to notice and to undo than a missed
    match. The gap is wide, so 0.75 sits far from both edges.
    """

    def test_threshold_is_075(self):
        assert SPINE_MIN_COVERAGE == 0.75

    def test_below_threshold_keeps_every_control(self):
        """45/45 controls at >= 0.75 on the real course."""
        controls = [0.807, 0.929]  # observed min and median
        assert all(c >= 0.75 for c in controls)

    def test_threshold_rejects_the_measured_outlier(self):
        """The outlier's best coverage against 5 reference traces was 0.593."""
        measured_outlier_coverage = 0.593
        assert measured_outlier_coverage < SPINE_MIN_COVERAGE

    def test_ninety_would_have_rejected_genuine_rides(self):
        """Why 0.90 is wrong: it strands real course members."""
        controls = [
            0.807, 0.815, 0.822, 0.830, 0.840, 0.850, 0.860, 0.870,
            0.880, 0.890,  # 10 rides below 0.90
        ]
        assert sum(1 for c in controls if c >= 0.90) == 0
        assert sum(1 for c in controls if c >= 0.75) == 10


class TestDetourGateIsOneDirectional:
    """Regression: the detour test must not be run in reverse.

    Run the other way it asks how far the *course* strays from the
    *ride*. A ride covering part of a course is then penalised for the
    part it never took: a 6.7 km lap of a 20 km course measured 13.3 km
    of "divergence" and was wrongly rejected. Only ride-vs-course
    expresses "left the course and did not come back".
    """

    @staticmethod
    def _line(lat0, lng0, lat1, lng1, n=200):
        return [
            (lat0 + (lat1 - lat0) * i / (n - 1), lng0 + (lng1 - lng0) * i / (n - 1))
            for i in range(n)
        ]

    def test_reverse_direction_would_report_a_false_divergence(self):
        course = self._line(55.94, -3.20, 56.12, -3.20)
        lap = course[:70]  # a prefix of the course, so forward divergence is 0
        forward = longest_uncovered_run_m(lap, course, 30.0)
        reverse = longest_uncovered_run_m(course, lap, 30.0)
        assert forward < 100.0, "the lap is entirely on the course"
        assert reverse > 5_000.0, "reverse direction is the false positive"

    def test_a_shorter_ride_on_a_course_is_not_rejected(self):
        course = self._line(55.94, -3.20, 56.12, -3.20)  # ~20 km
        lap = self._line(55.94, -3.20, 56.00, -3.20)  # ~6.7 km
        assert passes_detour_test(lap, course) is True


class TestRoadSignalDefusesTheDetourGate:
    """A strong road signal stands in for geometry the detour test cannot judge.

    The case that needs this is a *point-to-point* pair sharing the same
    OSM ways: geometry alone reports a large divergence because the two
    traces do not overlap end-to-end, but the road signal says they
    traverse the same edges. Without the exemption, the detour test would
    reject genuine same-road pairs that the road signal is specifically
    there to rescue.
    """

    def test_divergent_geometry_with_weak_road_signal_is_rejected(self):
        from app.services.route_matching import score_route_pair

        course = _line(55.94, -3.20, 56.12, -3.20, n=200)
        # Runs away from the course after the first third.
        other = _line(55.94, -3.20, 55.95, -3.05, n=200)
        bd = score_route_pair(other, course, road_jaccard=0.10)
        assert bd.detour_ok is False
        assert not bd.matched

    def test_strong_road_signal_defuses_the_gate(self):
        from app.services.route_matching import score_route_pair

        course = _line(55.94, -3.20, 56.12, -3.20, n=200)
        other = _line(55.94, -3.20, 55.95, -3.05, n=200)
        bd = score_route_pair(other, course, road_jaccard=0.95)
        assert bd.detour_m > bd.detour_budget_m, "the geometry still diverges"
        assert bd.detour_ok is True, "but the road signal defuses the gate"

    def test_exemption_needs_a_strong_signal(self):
        """A middling road signal must not defuse the gate."""
        from app.services.route_matching import score_route_pair

        course = _line(55.94, -3.20, 56.12, -3.20, n=200)
        other = _line(55.94, -3.20, 55.95, -3.05, n=200)
        bd = score_route_pair(other, course, road_jaccard=0.60)
        assert bd.detour_ok is False


class TestDetourTestGate:
    def test_detour_within_budget_passes(self):
        """A ~20 km course, so the 10% term (2 km) and the 2 km floor agree.

        The fixture has to be a realistic course length: on a 2 km course
        a 2 km detour is over budget by definition, which would make the
        test pass for the wrong reason.
        """
        base = _line(55.94, -3.20, 56.12, -3.20, n=400)  # ~20 km
        assert detour_budget_m(polyline_length(base)) > 1_900.0
        ride = _offset_run(base, 100, 4)  # ~4 points ~= 200 m
        assert passes_detour_test(ride, base) is True

    def test_short_course_can_exceed_the_floor_and_still_fail(self):
        """A 2.2 km course with a 2.2 km detour is over the 2 km budget.

        Pins that the floor is a floor, not a ceiling: a tiny course does
        not become free-form. The branch is offset far enough (~2.4 km) to
        clear the 50 m tolerance and genuinely exceed the budget.
        """
        base = _line(55.94, -3.20, 55.96, -3.20, n=400)
        ride = _offset_run(base, 100, 400, dlng=0.030)
        assert detour_budget_m(polyline_length(base)) == pytest.approx(2_000.0)
        assert longest_uncovered_run_m(ride, base, 50.0) > 2_000.0
        assert passes_detour_test(ride, base) is False

    def test_detour_beyond_budget_fails(self):
        base = _line(55.94, -3.20, 56.12, -3.20, n=400)  # ~20 km
        ride = _offset_run(base, 100, 80, dlng=0.05)  # ~4 km
        assert passes_detour_test(ride, base) is False

    def test_a_ride_that_leaves_and_never_returns_fails(self):
        """The parked 10 Aug 2026 case, in miniature.

        It shares the start of the course and then makes a long excursion
        to somewhere else. Containment scores it ~0.63, which is the
        median of legitimate same-course pairs, so no containment
        threshold catches it. The detour test is what catches it.
        """
        base = _line(55.94, -3.20, 55.98, -3.20, n=400)
        # shares ~15% of the course, then runs 8 km west
        ride = list(base[:60]) + _line(55.95, -3.20, 55.95, -3.30, n=340)
        assert passes_detour_test(ride, base) is False
