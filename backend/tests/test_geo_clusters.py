"""``geo_cluster_segments`` -- the cross-route hill identity primitive.

Pure function, so this is a plain unit test with no database and no Modal.

The case that matters most is the false-positive one: two genuinely different
hills that happen to be near each other must **not** merge. An over-merge is
worse than two rows, because the merged leaderboard then reports a "best" the
rider never actually rode, and nothing in the UI can tell them apart.
"""

from __future__ import annotations

import uuid

import pytest

from app.services.geo_clusters import (
    START_TOL_M,
    geo_cluster_segments,
    haversine_m,
)

# Rivington Hill, somewhere on earth.
BASE = {
    "start_lat": 53.8000,
    "start_lng": -2.5900,
    "end_lat": 53.8090,
    "end_lng": -2.5900,
    "distance_m": 1000.0,
    "avg_gradient_pct": 6.0,
}


def _seg(**overrides) -> dict:
    seg = dict(BASE)
    seg["id"] = overrides.pop("id", uuid.uuid4())
    seg.update(overrides)
    return seg


class TestHaversine:
    def test_zero_distance(self):
        assert haversine_m(53.8, -2.59, 53.8, -2.59) == pytest.approx(0.0)

    def test_known_distance(self):
        """One degree of latitude is ~111 km everywhere."""
        metres = haversine_m(53.0, -2.59, 54.0, -2.59)
        assert 110_000 < metres < 111_400

    def test_symmetric(self):
        forward = haversine_m(53.8, -2.59, 53.9, -2.5)
        backward = haversine_m(53.9, -2.5, 53.8, -2.59)
        assert forward == pytest.approx(backward)

    def test_tolerance_is_about_the_right_size(self):
        """150 m must be a real distance check, not a coordinate-magnitude check."""
        # ~0.001 deg latitude is ~111 m.
        assert haversine_m(53.8, -2.59, 53.801, -2.59) < START_TOL_M
        assert haversine_m(53.8, -2.59, 53.81, -2.59) > START_TOL_M


class TestSameHill:
    def test_same_hill_on_two_routes_merges(self):
        a = _seg(start_lng=-2.5905)  # ~35 m west
        b = _seg(start_lng=-2.5895)  # ~35 m east
        result = geo_cluster_segments([a, b])
        assert result[a["id"]] == result[b["id"]]

    def test_ridden_in_reverse_direction_merges(self):
        """Endpoints match as an unordered pair.

        The same hill ridden downhill has its start and end swapped. Comparing
        them in order would refuse to merge the two, which is precisely the case
        this column exists for.
        """
        forward = _seg()
        reverse = _seg(
            start_lat=BASE["end_lat"],
            start_lng=BASE["end_lng"],
            end_lat=BASE["start_lat"],
            end_lng=BASE["start_lng"],
        )
        result = geo_cluster_segments([forward, reverse])
        assert result[forward["id"]] == result[reverse["id"]]

    def test_chain_of_three_merges(self):
        """Transitive closure: A-B and B-C put A, B and C in one hill."""
        a = _seg(start_lng=-2.5910)
        b = _seg(start_lng=-2.5900)
        c = _seg(start_lng=-2.5890)
        result = geo_cluster_segments([a, b, c])
        assert result[a["id"]] == result[b["id"]] == result[c["id"]]


class TestAdjacentHillsMustNotMerge:
    """The false-positive gate."""

    def test_two_hills_800m_apart_do_not_merge(self):
        a = _seg()
        # ~800 m further north: same profile, genuinely a different climb.
        b = _seg(start_lat=53.8072, end_lat=53.8162)
        result = geo_cluster_segments([a, b])
        assert result[a["id"]] != result[b["id"]]

    def test_length_16_percent_apart_does_not_merge(self):
        a = _seg(distance_m=1000.0)
        b = _seg(distance_m=1200.0)  # 16.7 % of the longer
        result = geo_cluster_segments([a, b])
        assert result[a["id"]] != result[b["id"]]

    def test_length_tolerance_is_measured_against_the_longer_segment(self):
        """The gate is ``|a - b| / max(a, b)``, not against the shorter.

        Worth pinning because the two readings disagree in exactly the range a
        test author reaches for first: 1000 m vs 1110 m is 11 % of the *shorter*
        but 9.91 % of the *longer*, so it merges. Normalising by the longer
        means a re-detection of the same hill may be up to 10 % shorter and
        still be the same hill, which is the lenient direction and the one that
        matches the spec.

        (Normalising by the shorter would be stricter and equally defensible,
        but it is not what was asked for, and silently switching would make
        existing labels shift for no stated reason.)
        """
        a = _seg(distance_m=1000.0)
        b = _seg(distance_m=1110.0)
        result = geo_cluster_segments([a, b])
        assert result[a["id"]] == result[b["id"]]

    def test_length_exactly_at_the_longer_relative_tolerance_merges(self):
        a = _seg(distance_m=1000.0)
        b = _seg(distance_m=1000.0 / (1 - 0.10))  # exactly 10 % of the longer
        result = geo_cluster_segments([a, b])
        assert result[a["id"]] == result[b["id"]]

    def test_length_just_over_the_longer_relative_tolerance_does_not_merge(self):
        a = _seg(distance_m=1000.0)
        b = _seg(distance_m=1120.0)  # 10.7 % of the longer
        result = geo_cluster_segments([a, b])
        assert result[a["id"]] != result[b["id"]]

    def test_length_just_inside_tolerance_merges(self):
        a = _seg(distance_m=1000.0)
        b = _seg(distance_m=1095.0)  # 8.7 % of the longer
        result = geo_cluster_segments([a, b])
        assert result[a["id"]] == result[b["id"]]

    def test_gradient_1_point_1_apart_does_not_merge(self):
        a = _seg(avg_gradient_pct=6.0)
        b = _seg(avg_gradient_pct=7.1)
        result = geo_cluster_segments([a, b])
        assert result[a["id"]] != result[b["id"]]

    def test_gradient_just_inside_tolerance_merges(self):
        a = _seg(avg_gradient_pct=6.0)
        b = _seg(avg_gradient_pct=6.9)
        result = geo_cluster_segments([a, b])
        assert result[a["id"]] == result[b["id"]]

    def test_same_start_different_end_does_not_merge(self):
        """Two climbs from one spot to different places are two climbs."""
        a = _seg()
        b = _seg(end_lat=53.8180)  # far end, near start
        result = geo_cluster_segments([a, b])
        assert result[a["id"]] != result[b["id"]]


class TestLabelShape:
    def test_singleton_keys_to_its_own_id(self):
        only = _seg()
        assert geo_cluster_segments([only]) == {only["id"]: only["id"]}

    def test_empty_input_is_empty_output(self):
        assert geo_cluster_segments([]) == {}

    def test_label_is_the_smallest_member_id(self):
        ids = sorted([uuid.uuid4() for _ in range(3)])
        segs = [_seg(id=i, start_lng=-2.5900 + n * 0.0004) for n, i in enumerate(ids)]
        result = geo_cluster_segments(segs)
        assert set(result.values()) == {ids[0]}

    def test_deterministic_across_calls(self):
        segs = [_seg(start_lng=-2.5900 + n * 0.0003) for n in range(4)]
        first = geo_cluster_segments(segs)
        # Shuffled input must not change the labelling.
        second = geo_cluster_segments(list(reversed(segs)))
        assert first == second

    def test_missing_coordinates_are_excluded_not_merged_at_null_island(self):
        """(0.0, 0.0) is a real number, not an absence.

        Treating a missing coordinate as 0.0 would gather every
        coordinate-less segment into one cluster off the coast of Africa.
        """
        located = _seg()
        missing = _seg(start_lat=None, end_lat=None, start_lng=None, end_lng=None)
        result = geo_cluster_segments([located, missing])
        assert missing["id"] not in result
        assert result[located["id"]] == located["id"]

    def test_partially_missing_coordinates_are_excluded(self):
        located = _seg()
        half = _seg(end_lng=None)
        result = geo_cluster_segments([located, half])
        assert half["id"] not in result


class TestScale:
    def test_many_unrelated_segments_stay_separate(self):
        """A guard against the grid bucketing merging distant things."""
        segs = [
            _seg(start_lat=53.0 + n * 0.05, end_lat=53.009 + n * 0.05)
            for n in range(40)
        ]
        result = geo_cluster_segments(segs)
        # Each is ~5.5 km north of the last, so all distinct.
        assert len(set(result.values())) == 40

    def test_pairs_across_a_grid_boundary_still_merge(self):
        """Candidate generation must not depend on which cell a segment lands in.

        Segments either side of a _GRID_DEG boundary are within a few metres of
        each other but in different buckets; a naive same-cell-only lookup would
        miss them and the hill would fragment into two.
        """
        # 53.8000 and 53.7999 straddle a cell boundary at 53.80.
        a = _seg(start_lat=53.79995, end_lat=53.80895)
        b = _seg(start_lat=53.79985, end_lat=53.80885)
        result = geo_cluster_segments([a, b])
        assert result[a["id"]] == result[b["id"]]