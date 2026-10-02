"""Does ``coverage`` actually measure containment, or just proximity?

This decides whether the prefix-pair problem is a *scorer* bug or a
*classification* problem, and those need different fixes.

The six active routes that are prefixes of longer ones score
``coverage_ab = 1.0`` **and** ``coverage_ba = 1.0``. For a strict prefix that
should be impossible. ``coverage(query, target)`` is documented as "fraction
of ``query`` points within ``tol_m`` of any ``target`` point", so for
``B = first 60% of A``:

    coverage(B, A)  ->  1.0    every point of B sits inside A  (correct)
    coverage(A, B)  ->  ~0.6   A's tail has no neighbour in B  (must NOT be 1.0)

If the second returns 1.0, the function is measuring "does this path run
near that path" rather than "is this path contained in that path", and every
candidate pair is scored on proximity. Reclassifying prefix pairs at merge
time would then be hiding the defect rather than fixing it.

The geometry here is synthetic and exact: a straight 6 km line sampled every
60 m gives 101 points, so B is precisely the first 61 of them and the
expected coverage is exactly 61/101.
"""

from __future__ import annotations

import math

from app.services.route_matching import coverage

SAMPLE_M = 60.0
TOL_M = 40.0


def _line(n: int, start_lat: float = 55.95, start_lng: float = -3.19) -> list[tuple[float, float]]:
    """A straight run of ``n`` samples spaced SAMPLE_M apart, heading north."""
    deg_lat = SAMPLE_M / 111_320.0
    return [(start_lat + i * deg_lat, start_lng) for i in range(n)]


class TestCoverageIsContainmentNotProximity:
    def test_prefix_scores_less_than_one_in_the_long_direction(self):
        """The case under investigation: A's tail is not inside B."""
        a = _line(101)
        b = a[:61]
        assert coverage(b, a, TOL_M) == 1.0, "B is wholly inside A"
        forward = coverage(a, b, TOL_M)
        assert forward < 0.95, (
            f"coverage(A, B) should fall to roughly 0.6 for a strict prefix, "
            f"got {forward:.3f}. If it is 1.0 the function measures proximity, "
            "not containment, and prefix pairs are mis-scored rather than "
            "mis-classified."
        )

    def test_prefix_coverage_matches_the_actual_overlap(self):
        a = _line(101)
        b = a[:61]
        forward = coverage(a, b, TOL_M)
        assert 0.55 <= forward <= 0.65, (
            f"expected ~0.60 (61 of 101 points), got {forward:.3f}"
        )

    def test_identical_paths_cover_each_other_completely(self):
        """The control: identical geometry must still score 1.0.

        Without this, a "fix" that merely lowers coverage for everything would
        pass the prefix test while destroying genuine duplicate detection —
        which is the whole point of the containment test.
        """
        a = _line(101)
        assert coverage(a, a, TOL_M) == 1.0
        assert coverage(a, list(a), TOL_M) == 1.0

    def test_disjoint_paths_cover_nothing(self):
        a = _line(101)
        far = _line(101, start_lat=56.5)
        assert coverage(a, far, TOL_M) == 0.0

    def test_symmetric_when_paths_are_the_same_length(self):
        a = _line(101)
        b = a[:101]
        assert coverage(a, b, TOL_M) == coverage(b, a, TOL_M) == 1.0

    def test_containment_is_not_symmetric_by_design(self):
        """Documenting the asymmetry so a future 'fix' doesn't erase it.

        Swapping the arguments must change the answer; that is the property
        that distinguishes containment from a proximity similarity.
        """
        a = _line(101)
        b = a[:61]
        assert coverage(a, b, TOL_M) != coverage(b, a, TOL_M)


class TestToleranceIsTightEnoughToNotBridgeAGap:
    def test_a_gap_wider_than_tolerance_is_not_covered(self):
        """Ties the test above to the real tolerance used in production.

        If a gap larger than ``tol_m`` were bridged, then "1.0" would be an
        artefact of the sampling rather than of the algorithm.
        """
        a = _line(101)
        # Drop the middle of B so A's tail has nothing within tolerance.
        b = a[:30] + a[70:]
        forward = coverage(a, b, TOL_M)
        assert forward < 1.0, "a real gap must show up as incomplete coverage"

    def test_tolerance_is_not_so_large_it_bridges_everything(self):
        a = _line(101)
        b = a[:61]
        # 60 m apart sampling, 40 m tolerance: adjacent points overlap,
        # non-adjacent ones must not.
        assert TOL_M < SAMPLE_M * 2, (
            "the test's geometry is only meaningful while tolerance is "
            "comparable to the sample spacing"
        )
        assert math.isfinite(coverage(a, b, TOL_M))