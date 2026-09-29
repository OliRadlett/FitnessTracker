"""Tests for source-aware activity polyline extraction.

Regression: `activities.raw_data` is not a reliable geometry source.
`merge_activity` keeps the primary row's `raw_data` while reassigning `source`,
so a ride first created from a geometry-less Wahoo payload and later enriched by
Strava keeps the Wahoo payload — its polyline lives only in
`activity_sources.raw_data`. Reading `activity.raw_data` alone broke route
linking, the UI map, GPX export and route seeding for every such ride.
"""

import types

from app.services.polyline_utils import extract_activity_polyline

POLY = "o}~mH~}xMz@z@z@z@z@z@"


def _activity(raw_data=None, sources=None):
    return types.SimpleNamespace(raw_data=raw_data, sources=sources or [])


def _source(provider, raw_data):
    return types.SimpleNamespace(provider=provider, raw_data=raw_data)


def test_reads_activity_raw_data_when_present():
    a = _activity(raw_data={"map": {"summary_polyline": POLY}})
    assert extract_activity_polyline(a) == POLY


def test_falls_back_to_source_when_raw_data_has_no_geometry():
    """The bug: raw_data is a Wahoo payload with no `map`, geometry in a source."""
    a = _activity(
        raw_data={"name": "Lunch Ride", "workout_type_id": 0, "minutes": 48},
        sources=[_source("strava", {"map": {"summary_polyline": POLY}})],
    )
    assert extract_activity_polyline(a) == POLY


def test_prefers_source_that_actually_has_a_polyline():
    """Multiple sources, only one holds geometry (and it may not be first)."""
    a = _activity(
        raw_data=None,
        sources=[
            _source("whoop", {"id": 1}),
            _source("wahoo", {"name": "ride"}),
            _source("strava", {"map": {"summary_polyline": POLY}}),
        ],
    )
    assert extract_activity_polyline(a) == POLY


def test_prefers_strava_when_several_have_geometry():
    a = _activity(
        raw_data=None,
        sources=[
            _source("wahoo", {"map": {"summary_polyline": "OTHER"}}),
            _source("strava", {"map": {"summary_polyline": POLY}}),
        ],
    )
    assert extract_activity_polyline(a) == POLY


def test_returns_none_when_nowhere_has_geometry():
    a = _activity(
        raw_data={"name": "Walk"},
        sources=[_source("wahoo", {"minutes": 37}), _source("whoop", {"id": 2})],
    )
    assert extract_activity_polyline(a) is None


def test_top_level_summary_polyline_variant():
    a = _activity(raw_data={"summary_polyline": POLY})
    assert extract_activity_polyline(a) == POLY


def test_ignores_empty_polyline_strings():
    """A Strava summary with `summary_polyline: ""` must not count as geometry."""
    a = _activity(
        raw_data={"map": {"summary_polyline": ""}},
        sources=[_source("strava", {"map": {"summary_polyline": POLY}})],
    )
    assert extract_activity_polyline(a) == POLY


def test_no_sources_attribute_does_not_raise():
    a = types.SimpleNamespace(raw_data=None)
    assert extract_activity_polyline(a) is None
