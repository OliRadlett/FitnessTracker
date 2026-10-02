"""Group segments that are the same physical hill, across different routes.

Pure, stdlib-only, no database and no Modal. It needs no compute, so keeping it
out of ``integrations/segment_intelligence.py`` avoids dragging a module-scope
``app.config`` import into the Modal image (AGENTS pitfall 16) and the
corresponding ``add_local_file`` mounting (pitfall 17) for zero benefit.

**Why this is not the existing ``cluster_id``.** ``_extract_segment_features``
builds its DBSCAN feature vector from gradient / length / gain *shape* only::

    [avg_grad/15.0, length_km/10.0, gain_m/500.0, max_grad/25.0, gain_per_km/100.0, shape]

No coordinates. So ``cluster_id = 3`` means "climbs that look statistically
alike" -- a training analogue, which is the right primitive for borrowing
efforts during prediction and the wrong one for identity. The same hill can land
in three clusters and three genuinely different hills can share one.

Membership rules -- four independent gates, two geographic and two geometric:

===========================  ==================================
geographic                   haversine(start) <= 150 m
                             haversine(end)   <= 150 m
geometric                    |distance_a - distance_b| <= 10 %
                             |gradient_a - gradient_b| <= 1.0 pt
===========================  ==================================

Endpoints are matched as an **unordered pair**, so a hill ridden in the opposite
direction still merges (its start and end are simply swapped). Both the
tolerance and the geometry gates are deliberately tight: an over-merge is worse
than two rows, because a merged leaderboard reports a "best" the rider never
actually rode.
"""

from __future__ import annotations

import math
import uuid
from collections.abc import Sequence

EARTH_RADIUS_M = 6_371_008.8

# Geographic tolerance for both endpoints. 150 m is roughly the GPS noise floor
# plus the width of a road, so the same hill detected from two routes lands
# inside it while two genuinely different climbs on a switchback road do not.
START_TOL_M = 150.0
END_TOL_M = 150.0

# Geometry gates. Length within 10% and gradient within 1.0 percentage point:
# routes detect the same hill with slightly different windows (900 m vs 950 m
# depending on elevation sampling), and too tight a window gate would fragment
# one hill into several -- which defeats the entire point of the column.
LENGTH_REL_TOL = 0.10
GRADIENT_TOL_PCT = 1.0

# Candidate-generation bucket size, in metres. Segments are bucketed by start
# point into a lat/lng grid so candidate pairs are sub-quadratic. Correctness
# must not depend on this: a pair is only ever merged after `_same_hill` says
# so, and the bucket lookup is a *superset* filter. A 4-cell (2x2) neighbourhood
# is searched so that segments in adjacent buckets can still match.
_GRID_DEG = 0.01  # ~1.1 km of latitude; comfortably wider than the tolerance


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    d_phi = p2 - p1
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def _same_hill(a: dict, b: dict) -> bool:
    """True when two segments are the same physical hill, in either direction."""
    forward = (
        haversine_m(a["start_lat"], a["start_lng"], b["start_lat"], b["start_lng"])
        <= START_TOL_M
        and haversine_m(a["end_lat"], a["end_lng"], b["end_lat"], b["end_lng"])
        <= END_TOL_M
    )
    # Unordered endpoints: the reverse-direction pair has its ends swapped.
    reverse = (
        haversine_m(a["start_lat"], a["start_lng"], b["end_lat"], b["end_lng"])
        <= START_TOL_M
        and haversine_m(a["end_lat"], a["end_lng"], b["start_lat"], b["start_lng"])
        <= END_TOL_M
    )
    if not (forward or reverse):
        return False

    longer = max(a["distance_m"], b["distance_m"])
    if longer <= 0:
        return False
    if abs(a["distance_m"] - b["distance_m"]) / longer > LENGTH_REL_TOL:
        return False
    return abs(a["avg_gradient_pct"] - b["avg_gradient_pct"]) <= GRADIENT_TOL_PCT


def _cell(lat: float, lng: float) -> tuple[int, int]:
    return (math.floor(lat / _GRID_DEG), math.floor(lng / _GRID_DEG))


def geo_cluster_segments(segments: Sequence[dict]) -> dict[uuid.UUID, uuid.UUID]:
    """Return ``segment_id -> cluster_id`` for segments that are the same hill.

    Each input dict needs ``id``, ``start_lat``, ``start_lng``, ``end_lat``,
    ``end_lng``, ``distance_m`` and ``avg_gradient_pct``.

    The cluster key is the **lexicographically smallest member segment id**, so
    a given set of members always labels identically within a run. Segments
    with missing coordinates are excluded rather than merged on incomplete data:
    treating (0.0, 0.0) as a real location would put every coordinate-less
    segment in one cluster off the coast of Africa.

    Key stability across recomputes is deliberately not guaranteed -- membership
    can change, and the smallest id changes with it. Every reader groups by the
    *current* value, so a shifted key simply re-groups. This is a display
    grouping, not a foreign key, and insisting on durable identity here is what
    would make the recompute carry-over (§2.4) unsound rather than merely
    careful.

    Transitive closure: A-B and B-C merge A, B and C. That is intended -- a
    hill sampled three ways along a route is one hill.
    """
    usable = [
        s
        for s in segments
        if s.get("start_lat") is not None
        and s.get("start_lng") is not None
        and s.get("end_lat") is not None
        and s.get("end_lng") is not None
    ]

    # Union-find over segment ids.
    parent: dict[uuid.UUID, uuid.UUID] = {s["id"]: s["id"] for s in usable}

    def find(x: uuid.UUID) -> uuid.UUID:
        parent.setdefault(x, x)
        root = x
        while parent[root] != root:
            root = parent[root]
        # Path compression.
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a: uuid.UUID, b: uuid.UUID) -> None:
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        # Attach the larger root under the smaller so the representative is
        # deterministic even before the final min() pass.
        lo, hi = sorted((ra, rb))
        parent[hi] = lo

    by_cell: dict[tuple[int, int], list[dict]] = {}
    for s in usable:
        by_cell.setdefault(_cell(s["start_lat"], s["start_lng"]), []).append(s)

    for s in usable:
        cell = _cell(s["start_lat"], s["start_lng"])
        for d_lat in (-1, 0, 1):
            for d_lng in (-1, 0, 1):
                for other in by_cell.get((cell[0] + d_lat, cell[1] + d_lng), ()):
                    if other["id"] == s["id"]:
                        continue
                    if _same_hill(s, other):
                        union(s["id"], other["id"])

    # `union` already keeps the lexicographically smallest root, so `find` is
    # the smallest member id. Computing it again from the members would be the
    # same answer; this is a comment because the two look redundant.

    # Smallest member id per group: the label.
    smallest: dict[uuid.UUID, uuid.UUID] = {}
    for sid in parent:
        root = find(sid)
        if root not in smallest or sid < smallest[root]:
            smallest[root] = sid
    return {sid: smallest[find(sid)] for sid in parent}