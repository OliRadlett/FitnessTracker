"""Unit tests for ride segment geometry + effort windowing (§3.13).

Pure functions — no database required. Segment detection math and the
stream-window effort computation are covered here.
"""

from app.services.segments import (
    climb_category,
    compute_effort_for_window,
    detect_climb_segments,
)


def _flat_profile(n: int = 1000, ele: float = 50.0) -> list[dict]:
    return [{"dist": float(i), "ele": ele, "lat": 51.0, "lng": -1.0} for i in range(n)]


# ── Climb detection ──────────────────────────────────────────────────────


def test_flat_profile_has_no_climbs():
    assert detect_climb_segments(_flat_profile()) == []


def test_sustained_climb_detected():
    pts = _flat_profile(1301)
    for i in range(200, 1201):
        pts[i]["ele"] = 50.0 + 0.1 * (i - 200)  # 10% for 1000m
    for i in range(1201, 1301):
        pts[i]["ele"] = 150.0

    segs = detect_climb_segments(pts)
    assert len(segs) == 1
    s = segs[0]
    assert abs(s["start_dist"] - 200.0) < 1.0
    assert abs(s["end_dist"] - 1200.0) < 1.0  # trimmed at the summit
    assert abs(s["distance_m"] - 1000.0) < 1.0
    assert abs(s["elevation_gain_m"] - 100.0) < 2.0
    assert 9.0 < s["avg_gradient_pct"] < 11.0
    assert s["peak_elevation_m"] == 150.0


def test_short_and_shallow_climbs_filtered():
    small = _flat_profile(600)
    for i in range(200, 500):
        small[i]["ele"] = 50.0 + 0.02 * (i - 200)  # 2%, 6m gain
    assert detect_climb_segments(small) == []


def test_sharp_descent_splits_climbs():
    pts = _flat_profile(1800)
    for i in range(200, 700):
        pts[i]["ele"] = 50.0 + 0.08 * (i - 200)
    # 40m drop over 50m (single-pair descents > 8m).
    for i in range(700, 750):
        pts[i]["ele"] = 190.0 - 0.8 * (i - 700)
    for i in range(750, 1300):
        pts[i]["ele"] = 130.0 + 0.08 * (i - 750)

    segs = detect_climb_segments(pts)
    assert len(segs) == 2


def test_climb_category_bands():
    assert climb_category(1000, 8.0) == "HC"
    assert climb_category(500, 6.0) == "1"
    assert climb_category(200, 6.0) == "2"
    assert climb_category(120, 4.5) == "3"
    assert climb_category(50, 3.5) == "4"
    assert climb_category(50, 2.0) is None


# ── Effort windowing ─────────────────────────────────────────────────────


def test_window_effort_basic():
    cum = [float(i) for i in range(1501)]
    eff = compute_effort_for_window(
        cum_dist=cum,
        dt=1.0,
        segment={"start_dist": 200.0, "end_dist": 1200.0, "distance_m": 1000.0},
        power=[250.0] * 1501,
        hr=[160.0] * 1501,
        altitude=[50.0 + 0.1 * max(0, i - 200) for i in range(1501)],
    )
    assert eff is not None
    assert eff["elapsed_seconds"] == 1000.0
    assert eff["avg_power_watts"] == 250.0
    assert eff["avg_hr"] == 160.0
    # VAM = 100m gain / 1000s * 3600 = 360 m/h.
    assert eff["effort_vam"] is not None and abs(eff["effort_vam"] - 360.0) < 1.0


def test_window_effort_skips_uncovered_ride():
    cum = [float(i) for i in range(900)]  # ride ends inside the segment
    eff = compute_effort_for_window(
        cum_dist=cum,
        dt=1.0,
        segment={"start_dist": 200.0, "end_dist": 1200.0, "distance_m": 1000.0},
    )
    assert eff is None


def test_window_effort_skips_partial_coverage():
    cum = [float(i) for i in range(1200)]  # ends at segment end exactly
    eff = compute_effort_for_window(
        cum_dist=cum,
        dt=1.0,
        segment={"start_dist": 200.0, "end_dist": 1200.0, "distance_m": 1000.0},
    )
    # Coverage == segment length (full window present) → ok.
    assert eff is not None

    cum2 = [float(i) for i in range(1100)]  # only ~900m of 1000m
    eff2 = compute_effort_for_window(
        cum_dist=cum2,
        dt=1.0,
        segment={"start_dist": 200.0, "end_dist": 1200.0, "distance_m": 1000.0},
    )
    assert eff2 is None


def test_window_effort_zero_or_short_distance():
    assert (
        compute_effort_for_window(
            cum_dist=[],
            dt=1.0,
            segment={"start_dist": 0.0, "end_dist": 100.0, "distance_m": 100.0},
        )
        is None
    )
