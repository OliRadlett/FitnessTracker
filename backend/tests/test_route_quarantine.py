"""Route quarantine: keep orphaned routes out of matching without deleting them.

67 of 108 routes carry zero linked activities. They are the residue of
earlier merges and lap-variant twins, and while they sit in the candidate
pool they pollute every duplicate/link query — a new activity can be
matched against a route nothing has ever been linked to, and the
similarity metric trains negatives against rows that should not count.

Quarantine is a soft exclusion: a ``quarantined_at`` stamp that the
candidate queries filter on. Nothing is deleted, so clearing the stamp
restores the previous behaviour exactly. That reversibility is the whole
point — the plan (ride-course-split Ph. 3) wants orphans out of the way
*before* course identity is recalibrated, so that the calibration is
measured against a clean pool rather than against garbage.

These tests cover the pure decision logic, which is where the judgement
lives. The SQL filters are covered by test_route_quarantine_filters.py,
which asserts every candidate site actually applies the predicate — a
correct predicate that nothing calls would pass every test here.
"""

from __future__ import annotations

import uuid

import pytest

from app.services.route_quarantine import (
    QUARANTINE_MIN_ACTIVITIES,
    containment,
    jaccard,
    orphan_route_ids,
    rank_recovery_candidates,
    split_quarantine_decision,
)


class TestOrphanSelection:
    def test_route_with_no_activities_is_an_orphan(self):
        a, b = uuid.uuid4(), uuid.uuid4()
        chosen = orphan_route_ids({a: 0, b: 5})
        assert chosen == [a]

    def test_routes_are_returned_in_a_stable_order(self):
        """Sorting by id keeps the quarantine list and its log reproducible."""
        ids = [uuid.uuid4() for _ in range(5)]
        assert orphan_route_ids({i: 0 for i in ids}) == sorted(ids)

    def test_no_orphans_returns_empty(self):
        assert orphan_route_ids({uuid.uuid4(): 3, uuid.uuid4(): 1}) == []

    def test_a_route_with_activities_is_never_orphaned(self):
        """The one-link case is the boundary; 1 must count as linked."""
        assert orphan_route_ids({uuid.uuid4(): 1}) == []

    def test_minimum_is_zero(self):
        """Quarantining is for *zero*-linked routes only.

        Pinned because it is the guard that makes this reversible in
        practice: anything with a linked activity is reachable by a user,
        so a bug in the counting query cannot hide a real course.
        """
        assert QUARANTINE_MIN_ACTIVITIES == 0

    def test_empty_input(self):
        assert orphan_route_ids({}) == []


class TestSplitDecision:
    """Quarantine is per-route, decided independently — never in bulk."""

    def test_dry_run_reports_without_deciding(self):
        a = uuid.uuid4()
        result = split_quarantine_decision({a: 0}, dry_run=True)
        assert result["to_quarantine"] == [a]
        assert result["would_change"] is True

    def test_dry_run_on_nothing_to_do(self):
        result = split_quarantine_decision({uuid.uuid4(): 4}, dry_run=True)
        assert result["to_quarantine"] == []
        assert result["would_change"] is False

    def test_already_quarantined_is_excluded(self):
        """Re-running must be a no-op, not a re-stamp.

        Otherwise a second run would overwrite the original timestamp and
        destroy the audit of when the route was actually set aside.
        """
        a = uuid.uuid4()
        result = split_quarantine_decision({a: 0}, dry_run=True, already={a})
        assert result["to_quarantine"] == []
        assert result["would_change"] is False

    def test_counts_orphans_and_keeps(self):
        a, b = uuid.uuid4(), uuid.uuid4()
        result = split_quarantine_decision({a: 0, b: 2}, dry_run=True)
        assert result["considered"] == 2
        assert result["kept"] == 1


class TestContainment:
    def test_identical_sets_are_fully_contained(self):
        s = {"1:1", "2:2", "3:3"}
        assert containment(s, set(s)) == 1.0

    def test_subset_scores_one(self):
        """A short ride entirely inside a long course is fully contained.

        This is the property that makes containment the right metric
        rather than Jaccard: Jaccard punishes the course for being long,
        which is backwards when asking "is this ride on that course?".
        """
        ride = {"1", "2"}
        course = {"1", "2", "3", "4"}
        assert containment(ride, course) == 1.0

    def test_containment_is_one_way_and_that_is_a_caveat(self):
        """min() means a short subset scores 1.0 against a long superset
        **and** the long superset scores 1.0 against the short subset.

        So containment alone cannot tell "the whole course" from "one lap
        of a longer course" — both are 1.0. That is why
        :func:`rank_recovery_candidates` breaks ties on Jaccard, and why
        containment is not safe as a standalone identity test.
        """
        short = {"1", "2"}
        long = {"1", "2", "3", "4", "5", "6"}
        assert containment(short, long) == 1.0
        assert containment(long, short) == 1.0
        # Jaccard, by contrast, separates them cleanly.
        assert jaccard(short, long) < jaccard(long, long)

    def test_disjoint_sets_score_zero(self):
        assert containment({"a"}, {"b"}) == 0.0

    def test_half_overlap(self):
        assert containment({"a", "b"}, {"b", "c"}) == 0.5

    def test_empty_set_scores_zero(self):
        assert containment(set(), {"a"}) == 0.0
        assert containment({"a"}, set()) == 0.0

    def test_both_empty_scores_zero(self):
        """Guards a ZeroDivisionError and an accidental 'perfect match'."""
        assert containment(set(), set()) == 0.0


class TestWayIdsDropDirection:
    """Edge ids are ``<way_id>:<edge_index>`` and the index encodes direction.

    Comparing raw edge ids makes a ride and its reverse share almost
    nothing, which is why containment is computed on way ids only.
    """

    def test_opposite_directions_on_the_same_way_are_equal(self):
        outward = {"123:5", "456:2"}
        inbound = {"123:9", "456:7"}
        assert containment(outward, inbound) == 1.0

    def test_different_ways_are_still_distinct(self):
        assert containment({"123:5"}, {"456:5"}) == 0.0


class TestRankRecoveryCandidates:
    @staticmethod
    def _r(name: str, ways: set[str]):
        return {"id": uuid.uuid4(), "name": name, "ways": ways}

    def test_near_duplicate_ranks_above_a_distant_route(self):
        live = [self._r("Silverknowes loop", {"1", "2", "3", "4", "5"})]
        dup = self._r("Cycling (slightly longer)", {"1", "2", "3", "4", "5", "6"})
        far = self._r("East Lothian", {"9", "8", "7", "6", "5"})

        ranked = rank_recovery_candidates([dup, far], live)
        assert ranked[0]["orphan_id"] == dup["id"]
        assert ranked[0]["live_id"] == live[0]["id"]
        assert ranked[0]["containment"] == 1.0

    def test_results_are_sorted_by_containment_descending(self):
        live = [self._r("course", {"1", "2", "3", "4"})]
        a = self._r("a", {"1", "2", "3", "4"})
        b = self._r("b", {"1", "2", "3", "9"})
        c = self._r("c", {"7", "8"})
        ranked = rank_recovery_candidates([a, b, c], live)
        scores = [r["containment"] for r in ranked]
        assert scores == sorted(scores, reverse=True)

    def test_orphan_with_no_ways_is_still_listed_at_zero(self):
        """Reported rather than dropped, so nothing vanishes silently."""
        live = [self._r("course", {"1", "2"})]
        empty = self._r("no geometry", set())
        ranked = rank_recovery_candidates([empty], live)
        assert len(ranked) == 1
        assert ranked[0]["containment"] == 0.0

    def test_no_live_routes_still_reports_each_orphan(self):
        """Reported with live_id None rather than dropped.

        A quarantine sweep that silently omits rows would hide the routes
        it could not explain, which are exactly the ones a human needs to
        look at.
        """
        rows = rank_recovery_candidates([self._r("x", {"1"})], [])
        assert len(rows) == 1
        assert rows[0]["live_id"] is None
        assert rows[0]["containment"] == 0.0

    def test_best_live_route_is_chosen_per_orphan(self):
        live = [
            self._r("close", {"1", "2", "3", "4"}),
            self._r("closer", {"1", "2", "3", "4", "5"}),
        ]
        orphan = self._r("o", {"1", "2", "3", "4", "5"})
        ranked = rank_recovery_candidates([orphan], live)
        assert len(ranked) == 1
        assert ranked[0]["live_name"] == "closer"
        assert ranked[0]["containment"] == 1.0

    def test_result_carries_names_for_the_review_ui(self):
        live = [self._r("Silverknowes loop", {"1", "2"})]
        orphan = self._r("Lunch Ride", {"1", "2"})
        row = rank_recovery_candidates([orphan], live)[0]
        assert row["orphan_name"] == "Lunch Ride"
        assert row["live_name"] == "Silverknowes loop"

    def test_live_never_matched_against_itself(self):
        """A route present in both lists must not match itself at 1.0."""
        r = self._r("same", {"1", "2", "3"})
        ranked = rank_recovery_candidates([r], [r])
        assert ranked[0]["containment"] == 0.0
