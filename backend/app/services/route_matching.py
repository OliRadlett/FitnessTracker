"""Route matching engine — pure geometric similarity for route dedup and
activity→route linking.

Shared by ``route_service``, ``merge_service`` and the Modal route-intelligence
worker. **Stdlib only at module scope** — no ``numpy``, no ``app.*`` imports, so
the module can be imported inside the bare Modal image (AGENTS pitfalls #33/#34).

The engine is scale- and direction-aware:

* Distance-resampled discrete **Fréchet** distance — order- and
  direction-sensitive, and (because discrete Fréchet allows a monotone
  many-to-one coupling) tolerant of lap-count differences (3 laps ↔ 5 laps of
  the same circuit) and short detours.
* **Symmetric coverage** on a dense, grid-indexed representation with a tight
  ~30 m tolerance — rejects a sub-section of a longer route (covers one way but
  not the other) while accepting the same broad route with a small town detour.
* Explicit **reversed** detection — a route ridden the other way never matches.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

_EARTH_RADIUS_M = 6_371_000.0
_M_PER_DEG_LAT = 110_540.0
_M_PER_DEG_LNG = 111_320.0

# ── Defaults (safe to override per call) ─────────────────────────────────────

DEFAULT_RESAMPLE_N = 200
DEFAULT_TOL_M = 30.0
DEFAULT_FRECHET_CEILING_M = 500.0
DEFAULT_AUTO_THRESHOLD = 0.82
DEFAULT_REVIEW_FLOOR = 0.55
DEFAULT_GATE = 0.45

# Relative weight of each composite component.
_W_COVERAGE = 0.60
_W_FRECHET = 0.25
_W_ENDPOINT = 0.15

# A reversed route's forward Fréchet is at least ~ (1/REVERSED_RATIO)× the
# reversed Fréchet; below this ratio the route is treated as reversed.
_REVERSED_RATIO = 0.8

_LOOP_THRESHOLD_M = 200.0


# ── Geometry primitives ──────────────────────────────────────────────────────


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres."""
    lat1_r, lng1_r = math.radians(lat1), math.radians(lng1)
    lat2_r, lng2_r = math.radians(lat2), math.radians(lng2)
    dlat = lat2_r - lat1_r
    dlng = lng2_r - lng1_r
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return _EARTH_RADIUS_M * c


def polyline_length(points: list[tuple[float, float]]) -> float:
    """Total length of a decoded polyline in metres."""
    total = 0.0
    for i in range(1, len(points)):
        total += haversine_distance(
            points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]
        )
    return total


def drop_jitter(
    points: list[tuple[float, float]], min_move_m: float = 3.0
) -> list[tuple[float, float]]:
    """Drop points closer than ``min_move_m`` to the previous kept point."""
    if not points:
        return []
    kept = [points[0]]
    for p in points[1:]:
        if haversine_distance(kept[-1][0], kept[-1][1], p[0], p[1]) >= min_move_m:
            kept.append(p)
    if len(kept) == 1 and len(points) > 1:
        kept.append(points[-1])
    return kept


def _perp_distance_m(
    p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> float:
    """Approximate perpendicular distance from point ``p`` to segment ``a``-``b``."""
    kx = _M_PER_DEG_LNG * math.cos(math.radians(a[0]))
    ky = _M_PER_DEG_LAT
    dx = (b[1] - a[1]) * kx
    dy = (b[0] - a[0]) * ky
    px = (p[1] - a[1]) * kx
    py = (p[0] - a[0]) * ky
    seg2 = dx * dx + dy * dy
    if seg2 == 0.0:
        return math.hypot(px, py)
    t = max(0.0, min(1.0, (px * dx + py * dy) / seg2))
    return math.hypot(px - t * dx, py - t * dy)


def simplify(
    points: list[tuple[float, float]], tolerance_m: float = 5.0
) -> list[tuple[float, float]]:
    """Douglas-Peucker simplification (iterative)."""
    n = len(points)
    if n < 3:
        return list(points)

    keep = [False] * n
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        start, end = stack.pop()
        if end <= start + 1:
            continue
        max_d = -1.0
        max_i = start
        for i in range(start + 1, end):
            d = _perp_distance_m(points[i], points[start], points[end])
            if d > max_d:
                max_d = d
                max_i = i
        if max_d > tolerance_m:
            keep[max_i] = True
            stack.append((start, max_i))
            stack.append((max_i, end))

    return [points[i] for i in range(n) if keep[i]]


def resample(
    points: list[tuple[float, float]], n: int
) -> list[tuple[float, float]]:
    """Resample to exactly ``n`` evenly-spaced points by cumulative distance."""
    if not points:
        return []
    if len(points) == 1 or n <= 1:
        return [points[0]] * max(n, 1)

    cum = [0.0]
    for i in range(1, len(points)):
        cum.append(
            cum[-1]
            + haversine_distance(
                points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]
            )
        )
    total = cum[-1]
    if total == 0.0:
        return [points[0]] * n

    step = total / (n - 1)
    out = [points[0]]
    target = step
    idx = 1
    while len(out) < n - 1:
        while idx < len(cum) and cum[idx] < target:
            idx += 1
        if idx >= len(points):
            break
        seg = cum[idx] - cum[idx - 1]
        frac = max(0.0, min(1.0, (target - cum[idx - 1]) / seg)) if seg else 0.0
        out.append(
            (
                points[idx - 1][0] + frac * (points[idx][0] - points[idx - 1][0]),
                points[idx - 1][1] + frac * (points[idx][1] - points[idx - 1][1]),
            )
        )
        target += step
    while len(out) < n:
        out.append(points[-1])
    out[-1] = points[-1]
    return out


def densify(
    points: list[tuple[float, float]], max_segment_m: float
) -> list[tuple[float, float]]:
    """Insert interpolated points so no segment exceeds ``max_segment_m``."""
    if len(points) < 2 or max_segment_m <= 0:
        return list(points)
    out = [points[0]]
    for i in range(1, len(points)):
        a, b = points[i - 1], points[i]
        d = haversine_distance(a[0], a[1], b[0], b[1])
        if d <= max_segment_m:
            out.append(b)
            continue
        steps = int(d // max_segment_m) + 1
        for k in range(1, steps + 1):
            f = k / steps
            out.append((a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])))
    return out


def _discrete_frechet(
    a: list[tuple[float, float]], b: list[tuple[float, float]]
) -> float:
    """Discrete Fréchet distance between two point sequences, in metres.

    Uses a rolling-row DP (O(n·m) time, O(m) memory). The monotone coupling
    means one sequence can be compressed onto the other, which is what makes
    lap-count differences (3 laps ↔ 5 laps) and short detours matchable.
    """
    n, m = len(a), len(b)
    if n == 0 or m == 0:
        return 0.0

    prev = [0.0] * m
    prev[0] = haversine_distance(*a[0], *b[0])
    for j in range(1, m):
        prev[j] = max(prev[j - 1], haversine_distance(*a[0], *b[j]))

    for i in range(1, n):
        cur = [0.0] * m
        cur[0] = max(prev[0], haversine_distance(*a[i], *b[0]))
        ai = a[i]
        for j in range(1, m):
            d = haversine_distance(ai[0], ai[1], b[j][0], b[j][1])
            cur[j] = max(min(prev[j], prev[j - 1], cur[j - 1]), d)
        prev = cur
    return prev[m - 1]


def _grid(
    points: list[tuple[float, float]], cell_deg: float
) -> dict[tuple[int, int], list[tuple[float, float]]]:
    g: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for p in points:
        key = (int(math.floor(p[0] / cell_deg)), int(math.floor(p[1] / cell_deg)))
        g.setdefault(key, []).append(p)
    return g


def coverage(
    query: list[tuple[float, float]],
    target: list[tuple[float, float]],
    tol_m: float,
) -> float:
    """Fraction of ``query`` points within ``tol_m`` of any ``target`` point.

    ``target`` is grid-indexed for an O(n) nearest-neighbour search.
    """
    if not query or not target:
        return 0.0
    cell_deg = tol_m / 110_000.0
    grid = _grid(target, cell_deg)
    covered = 0
    for q in query:
        cy = int(math.floor(q[0] / cell_deg))
        cx = int(math.floor(q[1] / cell_deg))
        found = False
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for p in grid.get((cy + dy, cx + dx), ()):
                    if haversine_distance(q[0], q[1], p[0], p[1]) <= tol_m:
                        found = True
                        break
                if found:
                    break
            if found:
                break
        if found:
            covered += 1
    return covered / len(query)


# ── Score model ──────────────────────────────────────────────────────────────


@dataclass
class ScoreBreakdown:
    """Every component of a route-pair match score, for explainability."""

    total: float
    matched: bool
    tier: str  # "auto" | "review" | "none"
    reversed: bool
    coverage_ab: float
    coverage_ba: float
    min_coverage: float
    frechet_forward_m: float
    frechet_reverse_m: float
    frechet_similarity: float
    endpoint_similarity: float
    length_ratio: float
    lap_ratio: float | None
    length_a_m: float
    length_b_m: float
    road_jaccard: float | None = None  # Phase 2 — OSM edge-set similarity
    embedding_similarity: float | None = None  # Phase 2 — route embedding cosine

    def to_dict(self) -> dict:
        return asdict(self)


def _endpoint_similarity(
    a_start: tuple[float, float],
    a_end: tuple[float, float],
    b_start: tuple[float, float],
    b_end: tuple[float, float],
) -> float:
    """Loop-aware start/end proximity, 0.0–1.0.

    Loops have start≈end, so only the start is compared (avoids double-counting
    the same point); point-to-point requires both ends to converge.
    """
    start_dist = haversine_distance(*a_start, *b_start)
    end_dist = haversine_distance(*a_end, *b_end)

    a_loop = haversine_distance(*a_start, *a_end) < _LOOP_THRESHOLD_M
    b_loop = haversine_distance(*b_start, *b_end) < _LOOP_THRESHOLD_M

    if a_loop and b_loop:
        if start_dist < 500:
            return 1.0
        if start_dist < 1000:
            return 0.3
        return 0.0

    if start_dist < 500 and end_dist < 500:
        return 1.0
    if start_dist < 1000 or end_dist < 1000:
        return 0.6
    if start_dist < 2000 or end_dist < 2000:
        return 0.3
    return 0.0


def _empty_breakdown(length_a: float, length_b: float) -> ScoreBreakdown:
    return ScoreBreakdown(
        total=0.0,
        matched=False,
        tier="none",
        reversed=False,
        coverage_ab=0.0,
        coverage_ba=0.0,
        min_coverage=0.0,
        frechet_forward_m=0.0,
        frechet_reverse_m=0.0,
        frechet_similarity=0.0,
        endpoint_similarity=0.0,
        length_ratio=0.0,
        lap_ratio=None,
        length_a_m=round(length_a, 1),
        length_b_m=round(length_b, 1),
    )


def score_route_pair(
    points_a: list[tuple[float, float]],
    points_b: list[tuple[float, float]],
    *,
    length_a: float | None = None,
    length_b: float | None = None,
    auto_threshold: float = DEFAULT_AUTO_THRESHOLD,
    review_floor: float = DEFAULT_REVIEW_FLOOR,
    gate: float = DEFAULT_GATE,
    resample_n: int = DEFAULT_RESAMPLE_N,
    tol_m: float = DEFAULT_TOL_M,
    frechet_ceiling_m: float = DEFAULT_FRECHET_CEILING_M,
    road_jaccard: float | None = None,
    embedding_similarity: float | None = None,
) -> ScoreBreakdown:
    """Score a candidate route pair. Returns a full :class:`ScoreBreakdown`.

    ``points_a`` / ``points_b`` are decoded ``(lat, lng)`` polylines. All
    thresholds are parameters so the engine stays config-free.
    """
    if len(points_a) < 2 or len(points_b) < 2:
        return _empty_breakdown(
            length_a or 0.0, length_b or 0.0
        )

    la = length_a if length_a is not None else polyline_length(points_a)
    lb = length_b if length_b is not None else polyline_length(points_b)
    if la <= 0 or lb <= 0:
        return _empty_breakdown(la, lb)

    # 1. Clean up + resample for Fréchet (order-sensitive).
    a_fr = resample(drop_jitter(points_a), resample_n)
    b_fr = resample(drop_jitter(points_b), resample_n)
    b_fr_rev = list(reversed(b_fr))

    frechet_fwd = _discrete_frechet(a_fr, b_fr)
    frechet_rev = _discrete_frechet(a_fr, b_fr_rev)

    length_ratio = min(la, lb) / max(la, lb)

    # 2. Direction: if reversing B matches far better, this is a reversed route.
    reversed_route = frechet_rev < frechet_fwd * _REVERSED_RATIO
    if reversed_route:
        bd = _empty_breakdown(la, lb)
        bd.reversed = True
        bd.length_ratio = round(length_ratio, 4)
        bd.frechet_forward_m = round(frechet_fwd, 1)
        bd.frechet_reverse_m = round(frechet_rev, 1)
        return bd

    # 3. Symmetric coverage on a dense representation (spatial, lap-tolerant).
    a_dense = densify(drop_jitter(points_a), max(tol_m / 2.0, 5.0))
    b_dense = densify(drop_jitter(points_b), max(tol_m / 2.0, 5.0))
    cov_ab = coverage(a_dense, b_dense, tol_m)
    cov_ba = coverage(b_dense, a_dense, tol_m)
    min_cov = min(cov_ab, cov_ba)

    frechet_sim = max(0.0, 1.0 - frechet_fwd / frechet_ceiling_m)
    endpoint = _endpoint_similarity(points_a[0], points_a[-1], points_b[0], points_b[-1])

    # Phase 2 — road-anchored signal (edge Jaccard and/or embedding cosine).
    road_signal: float | None = None
    if road_jaccard is not None:
        road_signal = max(0.0, min(1.0, road_jaccard))
    if embedding_similarity is not None:
        es = max(0.0, min(1.0, embedding_similarity))
        road_signal = es if road_signal is None else (road_signal + es) / 2.0

    # The gate is relaxed when the road/embedding signal is strong: routes that
    # traverse ~the same roads match even if raw GPS coverage is mediocre.
    effective_cov = max(min_cov, road_signal or 0.0)

    # Hard gates.
    if effective_cov < gate:
        bd = _empty_breakdown(la, lb)
        bd.coverage_ab = round(cov_ab, 4)
        bd.coverage_ba = round(cov_ba, 4)
        bd.min_coverage = round(min_cov, 4)
        bd.frechet_forward_m = round(frechet_fwd, 1)
        bd.frechet_similarity = round(frechet_sim, 4)
        bd.endpoint_similarity = round(endpoint, 4)
        bd.length_ratio = round(length_ratio, 4)
        bd.road_jaccard = road_signal
        bd.embedding_similarity = embedding_similarity
        return bd

    total = (
        _W_COVERAGE * min_cov
        + _W_FRECHET * frechet_sim
        + _W_ENDPOINT * endpoint
    )
    if road_signal is not None:
        total = 0.7 * total + 0.3 * road_signal

    if total >= auto_threshold:
        tier = "auto"
    elif total >= review_floor:
        tier = "review"
    else:
        tier = "none"

    lap_ratio = None
    if length_ratio > 0:
        raw = max(la, lb) / min(la, lb)
        nearest = round(raw)
        if nearest >= 2 and abs(raw - nearest) <= 0.15:
            lap_ratio = float(nearest)

    return ScoreBreakdown(
        total=round(total, 4),
        matched=total >= review_floor,
        tier=tier,
        reversed=False,
        coverage_ab=round(cov_ab, 4),
        coverage_ba=round(cov_ba, 4),
        min_coverage=round(min_cov, 4),
        frechet_forward_m=round(frechet_fwd, 1),
        frechet_reverse_m=round(frechet_rev, 1),
        frechet_similarity=round(frechet_sim, 4),
        endpoint_similarity=round(endpoint, 4),
        length_ratio=round(length_ratio, 4),
        lap_ratio=lap_ratio,
        length_a_m=round(la, 1),
        length_b_m=round(lb, 1),
        road_jaccard=road_signal,
        embedding_similarity=embedding_similarity,
    )


def frechet_similarity(
    points_a: list[tuple[float, float]],
    points_b: list[tuple[float, float]],
    *,
    resample_n: int = DEFAULT_RESAMPLE_N,
    frechet_ceiling_m: float = DEFAULT_FRECHET_CEILING_M,
) -> float:
    """Order- and direction-sensitive Fréchet similarity (0.0–1.0)."""
    if len(points_a) < 2 or len(points_b) < 2:
        return 0.0
    a = resample(drop_jitter(points_a), resample_n)
    b = resample(drop_jitter(points_b), resample_n)
    dist = _discrete_frechet(a, b)
    return max(0.0, 1.0 - dist / frechet_ceiling_m)


def cheap_candidate(
    points_a: list[tuple[float, float]],
    points_b: list[tuple[float, float]],
    *,
    length_a: float | None = None,
    length_b: float | None = None,
    min_length_ratio: float = 0.2,
    bbox_pad_m: float = 5000.0,
) -> bool:
    """Cheap pre-filter to skip obviously-unrelated pairs before full scoring.

    Screens on length ratio and (padded) bounding-box overlap. Both routes must
    have ≥2 points.
    """
    if len(points_a) < 2 or len(points_b) < 2:
        return False

    la = length_a if length_a is not None else polyline_length(points_a)
    lb = length_b if length_b is not None else polyline_length(points_b)
    if la <= 0 or lb <= 0:
        return False
    if min(la, lb) / max(la, lb) < min_length_ratio:
        return False

    def bbox(pts):
        lats = [p[0] for p in pts]
        lngs = [p[1] for p in pts]
        return min(lats), min(lngs), max(lats), max(lngs)

    a_lat0, a_lng0, a_lat1, a_lng1 = bbox(points_a)
    b_lat0, b_lng0, b_lat1, b_lng1 = bbox(points_b)

    pad_lat = bbox_pad_m / _M_PER_DEG_LAT
    pad_lng = bbox_pad_m / (_M_PER_DEG_LNG * max(math.cos(math.radians(a_lat0)), 0.01))

    return not (
        a_lat1 + pad_lat < b_lat0
        or b_lat1 + pad_lat < a_lat0
        or a_lng1 + pad_lng < b_lng0
        or b_lng1 + pad_lng < a_lng0
    )
