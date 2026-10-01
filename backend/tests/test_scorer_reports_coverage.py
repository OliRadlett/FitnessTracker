"""Does ``score_route_pair`` report ``coverage`` faithfully?

``coverage()`` passes its own containment tests — for a strict prefix it
returns ~0.6 in the long direction, which is correct. But real data still
shows prefix-shaped pairs scoring ``coverage_ab = 1.0`` *and*
``coverage_ba = 1.0``, and ``total = 1.0``, for routes whose distances differ
by 21%.

So the defect, if there is one, is not in ``coverage`` itself. It is either:

- in how ``score_route_pair`` *calls* it — resampling or densifying in a way
  that inflates both directions, or
- in what the ``breakdown`` fields labelled ``coverage_ab``/``coverage_ba``
  actually contain, if they are not ``coverage()`` output verbatim.

This builds a synthetic strict prefix (B = first 60% of A) and drives it
through ``score_route_pair`` end to end. If the scorer reports 1.0 both ways
on geometry whose containment is provably 0.6, then the real-data result is
a scorer defect and reclassifying prefix pairs at merge time would be hiding
it. If it correctly reports ~0.6, then the real pairs genuinely overlap
completely and the 21% distance gap has some other explanation worth finding.
"""

from __future__ import annotations

import math

from app.services.route_matching import coverage, score_route_pair

SAMPLE_M = 60.0


def _line(n: int, start_lat: float = 55.95, start_lng: float = -3.19):
    deg_lat = SAMPLE_M / 111_320.0
    return [(start_lat + i * deg_lat, start_lng) for i in range(n)]


def _length(points) -> float:
    total = 0.0
    for i in range(len(points) - 1):
        dy = (points[i + 1][0] - points[i][0]) * 111_320.0
        dx = (points[i + 1][1] - points[i][1]) * 111_320.0 * math.cos(
            math.radians(points[i][0])
        )
        total += math.hypot(dx, dy)
    return total


class TestScorerReportsCoverageFaithfully:
    def test_strict_prefix_is_not_scored_as_identical(self):
        a = _line(101)
        b = a[:61]
        length_a, length_b = _length(a), _length(b)

        bd = score_route_pair(a, b, length_a=length_a, length_b=length_b)
        d = bd.to_dict()

        assert d["coverage_ab"] < 0.95, (
            f"scorer reports coverage_ab={d['coverage_ab']} for a strict "
            f"prefix, but coverage() returns {coverage(a, b, 40.0):.3f} for the "
            "same geometry. The scorer is not reporting coverage faithfully."
        )

    def test_prefix_total_is_below_one(self):
        """The user-visible consequence: a truncated recording must not look
        like the same ride, or it trains the metric on the wrong answer."""
        a = _line(101)
        b = a[:61]
        bd = score_route_pair(a, b, length_a=_length(a), length_b=_length(b))
        assert bd.total < 1.0, (
            f"total={bd.total} for a 60% prefix — identical-looking scores are "
            "what put truncated recordings into the merge queue as top tier"
        )

    def test_identical_paths_still_score_one(self):
        """The control. A 'fix' that lowered everything would pass the tests
        above while destroying duplicate detection."""
        a = _line(101)
        bd = score_route_pair(a, a, length_a=_length(a), length_b=_length(a))
        assert bd.total >= 0.99, f"identical paths scored {bd.total}"
        assert bd.matched

    def test_breakdown_coverage_matches_coverage_function(self):
        """Whatever the breakdown reports, it must agree with ``coverage``.

        If these disagree, the field shown to the user is not the quantity the
        algorithm computed, and reading the breakdown to audit a merge is
        reading a fiction.
        """
        a = _line(101)
        b = a[:61]
        d = score_route_pair(a, b, length_a=_length(a), length_b=_length(b)).to_dict()
        assert math.isclose(
            d["coverage_ab"], coverage(a, b, 40.0), abs_tol=0.02
        ), (
            f"breakdown says coverage_ab={d['coverage_ab']:.3f} but "
            f"coverage() says {coverage(a, b, 40.0):.3f}"
        )