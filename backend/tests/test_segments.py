"""Unit tests for ride segment geometry + effort windowing (§3.13).

Pure functions — no database required. Segment detection math and the
stream-window effort computation are covered here.
"""

from app.services.segments import (
    _activity_cumulative_distance,
    _clean_distance_stream,
    _mean,
    _resample_onto_axis,
    _resolve_cumulative_distance,
    _time_axis,
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


# ── Stream timebase (B4) ──────────────────────────────────────────────────
#
# Strava reports a per-stream `resolution` as the *string* "high"/"low", so
# `ActivityStream.resolution` is NULL in the database and the old code assumed
# 1 second per sample for everything. That is only true for the streams Strava
# resamples; the ones it returns at the device's native rate
# (`velocity_smooth`, `distance`) have GPS-dependent spacing, so both the
# integrated distance and every duration derived from it were wrong.


def test_time_axis_normalises_to_elapsed_seconds():
    assert _time_axis({"time": [1_700_000_000, 1_700_000_001, 1_700_000_003]}) == [
        0.0,
        1.0,
        3.0,
    ]


def test_time_axis_rejects_unusable_streams():
    assert _time_axis({"time": []}) is None
    assert _time_axis({"time": [5.0]}) is None  # single sample, no spacing
    assert _time_axis({"time": [0.0, 0.0, 1.0]}) is None  # not increasing
    assert _time_axis({"time": [0.0, 5.0, 1.0]}) is None  # goes backwards
    assert _time_axis({"time": [0.0, None, 2.0]}) is None  # gap
    assert _time_axis({"time": ["a", "b"]}) is None  # non-numeric
    assert _time_axis({}) is None


def test_velocity_integration_uses_real_timing_not_assumed_1s():
    # 11 samples over 100 elapsed seconds: 10 m/s, but one sample every 10s.
    # With the old dt=1 assumption this integrated to 100 m instead of 1000 m.
    times = [float(i * 10) for i in range(11)]
    cum = _activity_cumulative_distance([10.0] * 11, None, times)
    assert cum[-1] == 1000.0


def test_velocity_integration_falls_back_to_resolution_without_time():
    cum = _activity_cumulative_distance([10.0] * 5, 2, None)
    assert cum == [0.0, 20.0, 40.0, 60.0, 80.0]


def test_velocity_integration_ignores_time_of_different_length():
    # A 3-sample time stream can't timebase a 6-sample velocity stream.
    cum = _activity_cumulative_distance([10.0] * 6, None, [0.0, 1.0, 2.0])
    assert cum == [0.0, 10.0, 20.0, 30.0, 40.0, 50.0]


def test_clean_distance_stream_holds_gaps_and_never_goes_backwards():
    assert _clean_distance_stream([0, None, 10, 9, 20, "x", 30]) == [
        0.0,
        0.0,
        10.0,
        10.0,
        20.0,
        20.0,
        30.0,
    ]


def test_clean_distance_stream_rejects_degenerate_input():
    assert _clean_distance_stream([]) == []
    assert _clean_distance_stream([0.0]) == []  # too short
    assert _clean_distance_stream([0.0, 0.0]) == []  # no distance covered
    assert _clean_distance_stream(["a", "b"]) == []


def test_resample_onto_axis_interpolates_linearly():
    # 5 native samples spanning 0..400 m, mapped onto a 9-sample 0..8 s axis:
    # each native interval covers 2 s, so each axis second is 50 m.
    out = _resample_onto_axis([0, 100, 200, 300, 400], [0, 1, 2, 3, 4, 5, 6, 7, 8])
    assert len(out) == 9
    assert out[0] == 0.0
    assert out[-1] == 400.0
    assert out[2] == 100.0  # exactly on a native sample
    # Halfway between native samples 1 and 2 → 150 m.
    assert abs(out[1] - 50.0) < 1e-6


def test_resample_onto_axis_needs_two_samples():
    assert _resample_onto_axis([1.0], [0, 1, 2]) == []
    assert _resample_onto_axis([0, 1, 2], [0]) == []


def test_resolve_prefers_distance_stream_over_velocity():
    # Same ride, two sources. The distance stream is authoritative; the
    # velocity integration would drift by 100 m over the recording.
    times = [float(i) for i in range(11)]
    streams = {
        "time": times,
        "distance": [float(i * 100) for i in range(11)],
        "velocity_smooth": [9.0] * 11,
        "watts": [250.0] * 11,
    }
    resolved = _resolve_cumulative_distance(streams)
    assert resolved is not None
    cum, elapsed = resolved
    assert cum[-1] == 1000.0  # not 990.0 from the velocity path
    assert elapsed == times


def test_resolve_resamples_low_res_distance_onto_the_time_axis():
    # Realistic: Strava returns `distance` at the device's native rate, which
    # is far coarser than the 1s high-resolution streams.
    times = [float(i) for i in range(101)]  # 1s, 101 samples
    streams = {
        "time": times,
        "distance": [float(i * 10) for i in range(11)],  # every 10s, 11 samples
        "watts": [200.0] * 101,
    }
    resolved = _resolve_cumulative_distance(streams)
    assert resolved is not None
    cum, elapsed = resolved
    # Resampled onto the 101-sample axis so it indexes with watts/altitude.
    assert len(cum) == 101
    assert len(elapsed) == 101
    assert cum[-1] == 100.0
    assert cum[50] == 50.0  # linear: 5 m/s throughout


def test_resolve_integrates_velocity_when_no_distance_stream():
    # Pre-B4 activities, and every non-Strava source, have no distance stream.
    streams = {
        "time": [float(i) for i in range(6)],
        "velocity_smooth": [5.0] * 6,
        "heartrate": [150.0] * 6,
    }
    resolved = _resolve_cumulative_distance(streams)
    assert resolved is not None
    cum, elapsed = resolved
    assert cum == [0.0, 5.0, 10.0, 15.0, 20.0, 25.0]
    assert elapsed == [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]


def test_resolve_falls_back_to_velocity_when_distance_is_unusable():
    streams = {
        "time": [float(i) for i in range(6)],
        "distance": [None, None, None, None, None, None],  # all nulls
        "velocity_smooth": [5.0] * 6,
    }
    resolved = _resolve_cumulative_distance(streams)
    assert resolved is not None
    cum, _ = resolved
    assert cum[-1] == 25.0


def test_resolve_returns_none_without_any_distance_source():
    assert _resolve_cumulative_distance({"heartrate": [150.0] * 10}) is None
    assert _resolve_cumulative_distance({}) is None


def test_resolve_without_time_stream_uses_recorded_resolution():
    # Non-Strava sources may record a numeric seconds-per-sample and have no
    # `time` stream; the old path must keep working.
    streams = {"velocity_smooth": [4.0] * 5, "resolution": 5}
    resolved = _resolve_cumulative_distance(streams)
    assert resolved is not None
    cum, elapsed = resolved
    assert cum == [0.0, 20.0, 40.0, 60.0, 80.0]
    assert elapsed == [0.0, 5.0, 10.0, 15.0, 20.0]


def test_effort_window_uses_the_time_axis_for_duration_and_speed():
    # 100 m per sample, one sample every 10 s → a genuine 10 m/s.
    cum = [float(i * 100) for i in range(11)]
    elapsed_axis = [float(i * 10) for i in range(11)]
    eff = compute_effort_for_window(
        cum_dist=cum,
        dt=10.0,
        segment={"start_dist": 0.0, "end_dist": 100.0, "distance_m": 100.0},
        elapsed_axis=elapsed_axis,
        power=[300.0] * 11,
    )
    assert eff is not None
    assert eff["elapsed_seconds"] == 10.0
    assert eff["avg_speed_mps"] == 10.0
    assert eff["avg_power_watts"] == 300.0

    # Same data with a hardcoded dt=1 (the pre-B4 assumption) reported 1 s
    # and 100 m/s — the mis-timing is a 10x error, not a rounding detail.
    wrong = compute_effort_for_window(
        cum_dist=cum,
        dt=1.0,
        segment={"start_dist": 0.0, "end_dist": 100.0, "distance_m": 100.0},
    )
    assert wrong is not None
    assert wrong["elapsed_seconds"] == 1.0
    assert wrong["avg_speed_mps"] == 100.0


def test_effort_window_falls_back_to_dt_for_a_mismatched_axis():
    cum = [float(i) for i in range(51)]
    eff = compute_effort_for_window(
        cum_dist=cum,
        dt=1.0,
        segment={"start_dist": 0.0, "end_dist": 50.0, "distance_m": 50.0},
        elapsed_axis=[0.0],  # wrong length → ignored
    )
    assert eff is not None
    assert eff["elapsed_seconds"] == 50.0


# ── Averages within a window (B5) ────────────────────────────────────────
#
# `_mean` used to filter `v not in (0, None)` for every signal. For power that
# silently discarded coasting, so a window ridden at 250 W with the last 20% of
# it coasting reported 250 W instead of 200 W — and `best_avg_power_watts` is
# the max over efforts, so the headline number was inflated too.


def test_mean_keeps_zeros_by_default_so_coasting_counts():
    # 8 samples at 250 W, 2 coasting → 200 W, not 250 W.
    assert _mean([250.0] * 8 + [0.0] * 2) == 200.0


def test_mean_can_drop_zeros_for_dropout_signals():
    # Heart rate: a 0 is a dropped strap reading, not a measurement.
    assert _mean([160.0, 0.0, 170.0], zero_is_dropout=True) == 165.0


def test_mean_of_all_zeros_is_zero_not_none():
    # A window ridden entirely coasting is a real 0 W, not "no data".
    assert _mean([0.0] * 5) == 0.0


def test_mean_drops_all_zeros_for_a_dropout_signal():
    assert _mean([0.0, 0.0], zero_is_dropout=True) is None


def test_mean_ignores_unusable_samples():
    assert _mean([100.0, None, "x", float("nan"), float("inf"), 200.0]) == 150.0


def test_mean_ignores_booleans():
    # bool subclasses int; True must not be counted as 1 W.
    assert _mean([True, False, 300.0]) == 300.0


def test_mean_returns_none_when_nothing_is_usable():
    assert _mean([]) is None
    assert _mean([None, None]) is None
    assert _mean(["a", "b"]) is None


def _window_effort(power=None, hr=None):
    """A 100 m window at 1 m/s with the given per-sample signals."""
    return compute_effort_for_window(
        cum_dist=[float(i) for i in range(101)],
        dt=1.0,
        segment={"start_dist": 0.0, "end_dist": 100.0, "distance_m": 100.0},
        power=power,
        hr=hr,
    )


def test_effort_window_averages_power_over_the_whole_window():
    # The window spans indices 0..100, i.e. 101 samples: 80 at 300 W and 21
    # coasting → 24000/101 = 237.6 W. Dropping the zeros reported 300 W.
    power = [300.0] * 80 + [0.0] * 21
    eff = _window_effort(power=power)
    assert eff is not None
    assert eff["avg_power_watts"] == 237.6


def test_effort_window_reports_an_all_coasting_window_as_zero_watts():
    eff = _window_effort(power=[0.0] * 101)
    assert eff is not None
    assert eff["avg_power_watts"] == 0.0


def test_effort_window_excludes_hr_dropouts_but_keeps_coasting_power():
    eff = _window_effort(
        power=[300.0] * 80 + [0.0] * 21,
        hr=[150.0] * 50 + [0.0] * 51,
    )
    assert eff is not None
    assert eff["avg_power_watts"] == 237.6
    assert eff["avg_hr"] == 150.0


def test_effort_window_reports_no_hr_when_the_whole_window_dropped_out():
    eff = _window_effort(hr=[0.0] * 101)
    assert eff is not None
    assert eff["avg_hr"] is None
