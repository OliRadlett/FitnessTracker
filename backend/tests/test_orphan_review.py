"""The orphan review queue: which quarantined routes still need a decision.

Quarantine hides a route from matching; it does not say anything about
whether the route *should* exist. That is a separate judgement the user
makes in the review queue, and it has three answers — merge it into a
matched route, keep it (un-quarantine), or dismiss it (leave quarantined
and stop showing it).

That means three states, not two, and collapsing them is the bug this file
exists to prevent: with only ``quarantined_at``, a route dismissed last
week is indistinguishable from one never reviewed, so the queue never
empties and the same wrong candidates are re-proposed on every sweep.

``dismissed_at`` is what makes "reviewed and rejected" durable. It is
deliberately separate from ``quarantined_at`` so a dismissed route can
still be un-quarantined later without losing the fact that it was judged
and rejected.

The queue's filter lives in the SQL of ``list_review_queue`` (this file
tests the pure bucketing and ordering it delegates to); the SQL predicate
itself is asserted in ``test_orphan_review_api``.
"""

from __future__ import annotations

import ast
import inspect

import pytest

from app.services.route_quarantine import (
    REVIEW_BUCKETS,
    bucket_for,
    review_row_bucket,
    review_sort_key,
)


def _written_attrs(func) -> set[str]:
    """Column names assigned by ``.values(...)`` inside ``func``.

    Asserting on what a function *writes*, not on substrings of its source:
    ``dismiss_route`` legitimately *reads* ``quarantined_at`` in its WHERE
    clause, so a text check is both too strict and too weak.
    """
    tree = ast.parse(inspect.getsource(func).lstrip())
    written: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not (isinstance(fn, ast.Attribute) and fn.attr == "values"):
            continue
        for kw in node.keywords:
            if kw.arg:
                written.add(kw.arg)
            elif isinstance(kw.value, ast.Attribute):
                written.add(kw.value.attr)
        for arg in node.args:
            if isinstance(arg, ast.Attribute):
                written.add(arg.attr)
            elif isinstance(arg, ast.Name):
                written.add(arg.id)
    return written


class TestBucketFor:
    def test_identical_signals_land_in_the_top_bucket(self):
        assert bucket_for(containment=0.99, jaccard=0.71) == "near_certain"

    def test_lap_of_a_longer_course_is_not_near_certain(self):
        """The case that made containment unusable on its own.

        An orphan entirely inside a live route scores containment 1.000,
        but Jaccard 0.300 says the sets differ in size — it is a lap of a
        longer course, not a duplicate. Bucketing on containment alone
        would have called it a near-certain merge.
        """
        assert bucket_for(containment=1.0, jaccard=0.30) != "near_certain"

    def test_moderate_both_ways_is_ambiguous(self):
        """High containment but low Jaccard: a lap, or a partial recording.

        0.65 containment never reaches the "likely" bar, so it falls to
        ambiguous however good the Jaccard looks.
        """
        assert bucket_for(containment=0.65, jaccard=0.40) == "ambiguous"
        # 0.75/0.40 IS a likely match — above the 0.70/0.20 bar.
        assert bucket_for(containment=0.75, jaccard=0.40) == "likely"

    def test_low_containment_is_distinct(self):
        assert bucket_for(containment=0.20, jaccard=0.15) == "distinct"

    def test_every_bucket_is_declared(self):
        for value in ("near_certain", "likely", "ambiguous", "distinct", "unscorable"):
            assert value in REVIEW_BUCKETS


class TestReviewRowBucket:
    """Data availability is the caller's judgement, not ``bucket_for``'s.

    A zero score is ambiguous on its own: it means either "these share no
    edges" (informative) or "there was nothing to compare against" (no
    data). Reading the first as the second badges every data-less orphan
    as confidently distinct.
    """

    def test_no_geometry_is_unscorable(self):
        assert (
            review_row_bucket(
                has_geometry=False, has_candidate=True, containment=0.0, jaccard=0.0
            )
            == "unscorable"
        )

    def test_no_candidate_is_unscorable(self):
        """A real orphan with nothing to compare against is no data."""
        assert (
            review_row_bucket(
                has_geometry=True, has_candidate=False, containment=0.0, jaccard=0.0
            )
            == "unscorable"
        )

    def test_zero_score_with_a_candidate_is_distinct_not_unscorable(self):
        """The bug this split exists to prevent.

        Shares no edges with its best candidate — a real measurement, and
        a genuinely distinct route. Calling it unscoreable would hide 28
        such routes behind "cannot compare".
        """
        assert (
            review_row_bucket(
                has_geometry=True, has_candidate=True, containment=0.0, jaccard=0.0
            )
            == "distinct"
        )

    def test_a_real_score_is_bucketed_normally(self):
        assert (
            review_row_bucket(
                has_geometry=True, has_candidate=True, containment=0.99, jaccard=0.71
            )
            == "near_certain"
        )

    def test_every_returned_bucket_is_declared(self):
        for geometry in (True, False):
            for candidate in (True, False):
                for cont, jac in ((0.0, 0.0), (0.2, 0.1), (0.99, 0.71), (1.0, 0.3)):
                    b = review_row_bucket(
                        has_geometry=geometry,
                        has_candidate=candidate,
                        containment=cont,
                        jaccard=jac,
                    )
                    assert b in REVIEW_BUCKETS


class TestDismissIsReversible:
    """Dismissing must not be a one-way door.

    ``keep_route`` clears both stamps, so a route the user was wrong about
    comes back — and, having been un-quarantined, is a live candidate again.
    """

    def test_keep_clears_both_stamps(self):
        from app.services import route_quarantine

        written = _written_attrs(route_quarantine.keep_route)
        assert {"quarantined_at", "dismissed_at"} <= written


class TestReviewSortKey:
    """Bucket order leads; containment no longer decides on its own.

    Sorting by containment put ``Evening Ride`` — containment 1.000,
    Jaccard 0.300, a *lap* — above genuine duplicates at 0.988. The row
    with the strongest containment signal was the one most likely to be a
    false positive, and it was first in the list.
    """

    def _key(self, **kw):
        base = {"has_geometry": True, "has_candidate": True}
        base.update(kw)
        return review_sort_key(**base)

    def test_best_bucket_sorts_first(self):
        strong = self._key(containment=0.99, jaccard=0.71)
        weak = self._key(containment=0.20, jaccard=0.15)
        assert strong < weak

    def test_a_lap_does_not_outrank_a_duplicate_just_on_containment(self):
        """The case the change exists for.

        Containment 1.000 / Jaccard 0.300 is a lap of a longer course.
        Containment 0.988 / Jaccard 0.649 is a genuine duplicate. Ranking
        on raw containment put the lap first.
        """
        lap = self._key(containment=1.0, jaccard=0.3)
        duplicate = self._key(containment=0.9876, jaccard=0.649)
        assert duplicate < lap, (
            "a genuine duplicate must sort above a lap regardless of "
            "containment, or the most confident-looking row is the likeliest "
            "false positive"
        )

    def test_buckets_are_ordered_most_to_least_confident(self):
        order = [
            self._key(containment=0.99, jaccard=0.71),
            self._key(containment=0.75, jaccard=0.30),
            self._key(containment=0.65, jaccard=0.40),
            self._key(containment=0.20, jaccard=0.15),
        ]
        assert order == sorted(order), (
            "near_certain < likely < ambiguous < distinct"
        )

    def test_unscorable_sorts_last_regardless_of_score(self):
        """Zero scores are not 'a very distant route' — they are no data."""
        scored = self._key(containment=0.30, jaccard=0.20)
        unscored = review_sort_key(
            containment=0.0,
            jaccard=0.0,
            has_geometry=False,
            has_candidate=False,
        )
        assert scored < unscored

    def test_no_candidate_sorts_with_the_unscoreable(self):
        """Nothing to compare against is the same state as nothing to read."""
        with_candidate = self._key(containment=0.0, jaccard=0.0)
        without = review_sort_key(
            containment=0.0,
            jaccard=0.0,
            has_geometry=True,
            has_candidate=False,
        )
        assert without > with_candidate

    def test_sort_is_stable_on_ties_so_ordering_is_deterministic(self):
        a = self._key(containment=0.75, jaccard=0.40)
        b = self._key(containment=0.75, jaccard=0.40)
        assert a == b

    def test_sort_agrees_with_the_badge_the_row_displays(self):
        """Sorting and badging by different rules is worse than either alone.

        The bucket a row is badged with must be the bucket that positioned
        it, or the order the list appears in reads as arbitrary.
        """
        samples = {
            "near_certain": (0.99, 0.71, True, True),
            "likely": (0.75, 0.30, True, True),
            "ambiguous": (0.65, 0.40, True, True),
            "distinct": (0.20, 0.15, True, True),
            "unscorable": (0.0, 0.0, False, False),
        }
        for expected, (cont, jac, geom, cand) in samples.items():
            badged = review_row_bucket(
                has_geometry=geom,
                has_candidate=cand,
                containment=cont,
                jaccard=jac,
            )
            assert badged == expected, f"{cont}/{jac} should be {expected}"
            assert REVIEW_BUCKETS.index(badged) == list(samples).index(expected)

        # And the keys must come out in declared bucket order.
        keys = [
            review_sort_key(
                has_geometry=geom,
                has_candidate=cand,
                containment=cont,
                jaccard=jac,
            )
            for cont, jac, geom, cand in samples.values()
        ]
        assert keys == sorted(keys)



