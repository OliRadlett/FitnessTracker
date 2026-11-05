"""Which activity streams we ask Strava for, and why that list is a contract.

``keys`` is comma-separated, so an extra stream type costs **no extra API call**
— only bytes. The usual "is this worth a request?" test therefore does not apply;
the question is whether anything will read the data. Two neighbouring streams
(``temp``, ``grade_smooth``) are deliberately not requested for that reason, and
the absence is asserted so adding them is a decision rather than a drift.
"""

from __future__ import annotations

import pytest

from app.integrations.strava_client import (
    DEFAULT_STREAM_TYPES,
    stream_keys,
)

# Everything the analytics pipeline already depends on.
_REQUIRED = {
    "time",  # the time axis: sample spacing is not uniform
    "heartrate",
    "watts",
    "cadence",
    "altitude",
    "velocity_smooth",
    "distance",  # exact segment alignment; velocity integration drifts
}


class TestDefaultStreams:
    def test_keeps_the_streams_the_pipeline_depends_on(self):
        assert _REQUIRED <= set(DEFAULT_STREAM_TYPES)

    def test_requests_latlng_for_exact_replay_geometry(self):
        """replay.py prefers recorded GPS over resampling the route polyline.

        The fallback is a *shape*, so a switchback or a detour off the matched
        route is smoothed away. Asking for latlng is free (same request).
        """
        assert "latlng" in DEFAULT_STREAM_TYPES

    def test_does_not_collect_streams_nothing_reads(self):
        """`temp` and `grade_smooth` have no consumer yet.

        This is not a rule that they can never be added — it is a rule that they
        are added *with* the reader, in the same change. Deleting an assertion
        here is the visible act of making that decision.
        """
        unused = {"temp", "grade_smooth", "moving"}
        assert unused.isdisjoint(DEFAULT_STREAM_TYPES)

    def test_no_duplicates(self):
        assert len(DEFAULT_STREAM_TYPES) == len(set(DEFAULT_STREAM_TYPES))


class TestStreamKeys:
    def test_defaults_to_the_module_list(self):
        keys = stream_keys()
        assert keys.split(",") == list(DEFAULT_STREAM_TYPES)

    def test_explicit_list_replaces_the_default(self):
        """The endpoint has no additive mode — an explicit list must not merge."""
        assert stream_keys(["watts"]) == "watts"

    @pytest.mark.parametrize("explicit", [["watts"], ["watts", "heartrate"]])
    def test_explicit_list_never_leaks_latlng(self, explicit):
        assert "latlng" not in stream_keys(explicit).split(",")
