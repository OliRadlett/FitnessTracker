"""Unit tests for §1.3 ride-context caching (pure mapping functions).

No database — exercises the shape projection (`analyze_ride` output → stored
`Activity.context` → endpoint `ride_metrics`), the FTP staleness check, and
fallbacks. Async DB helpers (`compute_activity_context`, `ensure_activity_contexts*`,
`compute_top_speed`) need a DB session and are exercised in integration/CI.
"""

from app.services.activity_context import (
    context_to_ride_metrics,
    ride_context_from_analysis,
    should_recompute_for_ftp,
)


def _full_analysis() -> dict:
    return {
        "power_zones": [
            {"zone_name": "z2", "zone_label": "Endurance", "seconds": 1800, "pct": 50},
            {"zone_name": "z4", "zone_label": "Threshold", "seconds": 600, "pct": 16.7},
        ],
        "normalized_power": 245,
        "intensity_factor": 0.82,
        "variability_index": 1.11,
        "efficiency_factor": 3.9,
        "vam": 1100.0,
        "decoupling": {"decoupling_pct": 4.2, "classification": "good"},
        "climbing_analysis": {"total_climbing_m": 830.0},
        "tss_breakdown": {"total_tss": 128.0, "tss_per_hour": 51.2},
    }


# ── ride_context_from_analysis ────────────────────────────────────────────


def test_project_analysis_to_stored_shape():
    ctx = ride_context_from_analysis(
        _full_analysis(), 62.4, 300, 128.0, "2026-09-08T00:00:00Z"
    )
    ride = ctx["ride"]
    assert ride["top_speed_kmh"] == 62.4
    assert ride["normalized_power"] == 245
    assert ride["decoupling_pct"] == 4.2
    assert ride["decoupling_class"] == "good"
    assert ride["climbing_meters"] == 830.0
    assert ride["tss"] == 128.0
    assert ride["tss_per_hour"] == 51.2
    assert len(ride["power_zones"]) == 2
    assert ride["power_zones"][0] == {
        "zone_name": "z2",
        "zone_label": "Endurance",
        "seconds": 1800,
        "pct": 50,
    }
    assert ctx["ftp_watts"] == 300
    assert ctx["computed_at"] == "2026-09-08T00:00:00Z"


def test_tss_falls_back_to_activity_tss_when_breakdown_absent():
    analysis = _full_analysis()
    analysis.pop("tss_breakdown")
    ctx = ride_context_from_analysis(analysis, None, None, 121.0)
    assert ctx["ride"]["tss"] == 121.0
    assert ctx["ride"]["tss_per_hour"] is None
    assert ctx["ftp_watts"] is None


def test_missing_optional_sections_project_to_none():
    ctx = ride_context_from_analysis({}, None, None, None)
    ride = ctx["ride"]
    for k in (
        "normalized_power",
        "intensity_factor",
        "variability_index",
        "efficiency_factor",
        "vam",
        "decoupling_pct",
        "decoupling_class",
        "climbing_meters",
        "tss_per_hour",
    ):
        assert ride[k] is None, k
    assert ride["power_zones"] == []


# ── context_to_ride_metrics ───────────────────────────────────────────────


def test_round_trip_ride_metrics():
    original = ride_context_from_analysis(_full_analysis(), 58.7, 280, 127.0)
    out = context_to_ride_metrics(original)
    assert out == original["ride"]
    assert out["power_zones"][1]["pct"] == 16.7


def test_invalid_context_returns_none():
    assert context_to_ride_metrics(None) is None
    assert context_to_ride_metrics({}) is None
    assert context_to_ride_metrics({"ride": {}}) is None
    assert context_to_ride_metrics("nope") is None


# ── should_recompute_for_ftp ──────────────────────────────────────────────


def test_same_ftp_serves_cache():
    ctx = ride_context_from_analysis(_full_analysis(), 1.0, 300, 100.0)
    assert should_recompute_for_ftp(ctx, 300) is False


def test_changed_ftp_recomputes():
    ctx = ride_context_from_analysis(_full_analysis(), 1.0, 300, 100.0)
    assert should_recompute_for_ftp(ctx, 310) is True


def test_none_ftp_treated_as_change():
    ctx = ride_context_from_analysis(_full_analysis(), 1.0, 300, 100.0)
    assert should_recompute_for_ftp(ctx, None) is True


def test_missing_context_recomputes():
    assert should_recompute_for_ftp(None, 300) is True
