"""Laps: Strava's shape in, our shape out, and pacing segments from either.

The two properties worth pinning are the ones that made this worth doing at all:
a 4x8 minute session must read as four segments rather than ten equal-time
slices, and a ride without laps must still produce the old pacing read rather
than nothing.
"""

from __future__ import annotations

import pytest

from app.services.session_analysis import pacing_segments_from_laps
from app.services.strava.laps import normalize_laps


class TestNormalizeLaps:
    def test_projects_and_renames(self):
        assert normalize_laps(
            [
                {
                    "lap_index": 1,
                    "elapsed_time": 480,
                    "moving_time": 470,
                    "distance": 3120.5,
                    "average_watts": 265.4,
                    "average_heartrate": 152,
                    "total_elevation_gain": 12,
                }
            ]
        ) == [
            {
                "index": 1,
                "elapsed_s": 480.0,
                "moving_s": 470.0,
                "distance_m": 3120.5,
                "avg_power": 265.4,
                "avg_hr": 152.0,
                "elevation_gain_m": 12.0,
            }
        ]

    def test_drops_a_lap_with_neither_duration_nor_distance(self):
        """A device artefact must not become a zero-length pacing segment."""
        assert normalize_laps(
            [{"lap_index": 1, "elapsed_time": 300}, {"lap_index": 2}]
        ) == [{"index": 1, "elapsed_s": 300.0}]

    @pytest.mark.parametrize("raw", [None, [], [{"lap_index": 1}]])
    def test_nothing_worth_storing_is_none(self, raw):
        assert normalize_laps(raw) is None

    def test_survives_a_non_numeric_value(self):
        assert normalize_laps(
            [{"lap_index": 1, "elapsed_time": "oops", "distance": 1000}]
        ) == [{"index": 1, "distance_m": 1000.0}]


class TestPacingSegmentsFromLaps:
    def test_four_intervals_read_as_four_segments(self):
        laps = [
            {"index": i, "elapsed_s": 480.0, "avg_power": 300.0} for i in range(1, 5)
        ]

        segments = pacing_segments_from_laps(laps)

        assert len(segments) == 4
        assert segments[0] == {"pct_start": 0.0, "pct_end": 25.0, "avg_power": 300.0}
        assert segments[-1]["pct_end"] == 100.0

    def test_boundaries_follow_lap_durations_not_equal_tenths(self):
        """A long warm-up lap must shift every later boundary."""
        laps = [
            {"index": 1, "elapsed_s": 600.0, "avg_power": 150.0},
            {"index": 2, "elapsed_s": 200.0, "avg_power": 350.0},
        ]

        segments = pacing_segments_from_laps(laps)

        assert segments[0]["pct_end"] == 75.0
        assert segments[1] == {"pct_start": 75.0, "pct_end": 100.0, "avg_power": 350.0}

    def test_missing_power_stays_none_rather_than_zero(self):
        """A lap with no meter is unknown, not 0 W — 0 would drag variability."""
        segments = pacing_segments_from_laps(
            [{"elapsed_s": 300.0}, {"elapsed_s": 300.0, "avg_power": 200.0}]
        )

        assert segments[0]["avg_power"] is None

    @pytest.mark.parametrize(
        "laps",
        [
            None,
            [],
            [{"elapsed_s": 900.0, "avg_power": 200.0}],  # one lap is the whole ride
            [{"elapsed_s": 0.0}, {"elapsed_s": 0.0}],  # no usable duration
        ],
    )
    def test_falls_back_to_the_time_slices(self, laps):
        """None sends the caller to the equal-tenths path — never to no pacing."""
        assert pacing_segments_from_laps(laps) is None
