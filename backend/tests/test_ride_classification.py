"""Deterministic ride-type classification from the intensity factor."""

from __future__ import annotations

from app.services.ride_classification import (
    classify_ride_type,
    purpose_matches_execution,
    ride_type_from_context,
)


def test_if_bands():
    assert classify_ride_type(0.40) == "recovery"
    assert classify_ride_type(0.70) == "endurance"
    assert classify_ride_type(0.85) == "tempo"
    assert classify_ride_type(1.00) == "threshold"
    assert classify_ride_type(1.12) == "vo2max"


def test_short_hard_ride_reads_as_vo2max():
    # Same IF, different duration: an interval session vs a sustained ride.
    assert classify_ride_type(0.95, duration_seconds=15 * 60) == "vo2max"
    assert classify_ride_type(0.95, duration_seconds=90 * 60) == "threshold"


def test_none_without_power():
    assert classify_ride_type(None) is None
    assert classify_ride_type(0) is None
    assert ride_type_from_context(None) is None
    assert ride_type_from_context({}) is None
    # A context with no ride block (e.g. a power-less commute) → None, no guess.
    assert ride_type_from_context({"tags": {"purpose": "commute"}}) is None


def test_from_context_reads_the_cached_if():
    assert ride_type_from_context({"ride": {"intensity_factor": 0.72}}) == "endurance"


def test_purpose_vs_execution_only_judges_the_confident_cases():
    # A "recovery" ride measured at tempo or harder did not do what it claimed.
    assert purpose_matches_execution("recovery", "recovery") is True
    assert purpose_matches_execution("recovery", "tempo") is False
    assert purpose_matches_execution("recovery", "vo2max") is False
    # A "race" measured as an easy spin is the same shape.
    assert purpose_matches_execution("race", "threshold") is True
    assert purpose_matches_execution("race", "endurance") is False


def test_purpose_vs_execution_is_unjudged_otherwise():
    # Other purposes are not intensity claims — no verdict either way.
    assert purpose_matches_execution("commute", "tempo") is None
    assert purpose_matches_execution("training", "threshold") is None
    assert purpose_matches_execution(None, "tempo") is None
    assert purpose_matches_execution("recovery", None) is None
