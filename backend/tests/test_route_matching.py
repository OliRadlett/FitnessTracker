"""Unit tests for the pure route-matching engine (no DB, no Modal)."""

import math

from app.services.route_matching import (
    cheap_candidate,
    coverage,
    densify,
    drop_jitter,
    polyline_length,
    resample,
    score_route_pair,
    simplify,
)

_LAT0 = 55.0
_M_PER_DEG_LAT = 110_540.0
_COS = math.cos(math.radians(_LAT0))


def _east_deg(metres: float) -> float:
    return metres / (111_320.0 * _COS)


def _line(length_km: float, step_m: float = 50.0):
    """Points along a straight east-bound line starting at (_LAT0, 0)."""
    metres = length_km * 1000.0
    n = int(metres // step_m) + 1
    return [(_LAT0, _east_deg(i * step_m)) for i in range(n)]


def _rect_circuit(size_km: float, step_m: float = 50.0):
    """A closed rectangular circuit (square), returned as points."""
    d = _east_deg(size_km * 1000.0)
    dn = (size_km * 1000.0) / _M_PER_DEG_LAT
    corners = [
        (_LAT0, 0.0),
        (_LAT0, d),
        (_LAT0 + dn, d),
        (_LAT0 + dn, 0.0),
        (_LAT0, 0.0),
    ]
    pts = []
    for i in range(len(corners) - 1):
        a, b = corners[i], corners[i + 1]
        seg_len = math.hypot((b[0] - a[0]) * _M_PER_DEG_LAT, (b[1] - a[1]) * 111_320.0 * _COS)
        n = max(int(seg_len // step_m), 1)
        for k in range(n):
            f = k / n
            pts.append((a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])))
    pts.append(corners[-1])
    return pts


def _with_town_detour(base: list[tuple[float, float]], dev_km: float = 0.8):
    """Return a copy of ``base`` with a short northward detour part-way along."""
    n = len(base)
    start = int(n * 0.4)
    end = int(n * 0.5)
    detour = [(_lat + dev_km * 1000.0 / _M_PER_DEG_LAT, lng) for _lat, lng in base[start:end]]
    return base[:start] + detour + base[end:]


# ── Primitives ───────────────────────────────────────────────────────────────


def test_length_and_resample():
    pts = _line(10.0, step_m=100.0)
    assert abs(polyline_length(pts) - 10_000.0) < 200.0

    rs = resample(pts, 50)
    assert len(rs) == 50
    assert rs[0] == pts[0]
    assert rs[-1] == pts[-1]


def test_simplify_straight_line_collapses_to_ends():
    pts = _line(5.0, step_m=10.0)
    simp = simplify(pts, tolerance_m=5.0)
    assert len(simp) == 2


def test_coverage_identical_is_one():
    pts = densify(_line(5.0, step_m=40.0), 15.0)
    assert coverage(pts, pts, 30.0) == 1.0


# ── Score tiers ──────────────────────────────────────────────────────────────


def test_identical_routes_auto_merge():
    pts = _line(40.0, step_m=40.0)
    bd = score_route_pair(pts, pts)
    assert bd.tier == "auto"
    assert not bd.reversed
    assert bd.min_coverage > 0.98
    assert bd.total > 0.95


def test_start_point_offset_still_matches():
    full = _line(40.0, step_m=40.0)
    shifted = full[20:] + [(_LAT0, _east_deg((len(full) + 20) * 40.0))]
    bd = score_route_pair(full, shifted)
    assert bd.matched
    assert bd.min_coverage > 0.9


def test_three_laps_vs_five_laps_of_same_circuit_match():
    base = _rect_circuit(5.0, step_m=40.0)
    three = base * 3
    five = base * 5
    bd = score_route_pair(three, five)
    assert bd.matched, bd.to_dict()
    assert bd.min_coverage > 0.9
    assert bd.lap_ratio == 5.0 or bd.lap_ratio is None  # length ratio ~0.6


def test_town_detour_on_long_route_matches():
    base = _line(60.0, step_m=40.0)
    variant = _with_town_detour(base, dev_km=0.8)
    bd = score_route_pair(base, variant)
    assert bd.matched, bd.to_dict()


def test_reversed_route_is_rejected():
    pts = _line(30.0, step_m=40.0)
    bd = score_route_pair(pts, list(reversed(pts)))
    assert bd.reversed
    assert bd.tier == "none"
    assert bd.total == 0.0


def test_sub_section_is_not_a_match():
    long_route = _line(60.0, step_m=40.0)
    short_route = long_route[: len(long_route) // 4]
    bd = score_route_pair(long_route, short_route)
    assert not bd.matched
    assert bd.min_coverage < 0.55


def test_parallel_roads_do_not_merge():
    a = _line(30.0, step_m=40.0)
    b = [(_lat + 500.0 / _M_PER_DEG_LAT, lng) for _lat, lng in a]
    bd = score_route_pair(a, b)
    assert not bd.matched


def test_different_routes_far_apart_do_not_merge():
    a = _line(30.0, step_m=40.0)
    b = [(_LAT0 + 0.5, lng) for _lat, lng in a]  # ~55 km north
    assert not cheap_candidate(a, b)
    bd = score_route_pair(a, b)
    assert not bd.matched


def test_gps_jitter_does_not_break_identical_match():
    import random

    rng = random.Random(42)
    base = _line(20.0, step_m=40.0)
    noisy = [
        (lat + rng.uniform(-1e-5, 1e-5), lng + rng.uniform(-1e-5, 1e-5))
        for lat, lng in base
    ]
    bd = score_route_pair(base, noisy)
    assert bd.matched
    assert bd.min_coverage > 0.9


def test_drop_jitter_removes_stationary_points():
    pts = [(_LAT0, 0.0), (_LAT0, 1e-7), (_LAT0, 2e-7), (_LAT0, _east_deg(100))]
    kept = drop_jitter(pts, min_move_m=3.0)
    assert len(kept) < len(pts)
