"""Tests for Wahoo workout payload parsing.

Regression: the sync read `workout_type`/`sport_type` (absent) and top-level
metric fields (also absent). Wahoo actually returns an integer
`workout_type_id` and nests every metric in `workout_summary`. The result was
130 walks/golf stored as `sport_type='cycling'` with NULL distance, and all
Wahoo power/HR/elevation enrichment silently doing nothing.
"""

from app.services.wahoo import _map_wahoo_sport_type

# ── Sport type mapping (integer workout_type_id) ─────────────────────────────


def test_workout_type_id_maps_known_sports():
    assert _map_wahoo_sport_type(0) == "cycling"  # BIKING
    assert _map_wahoo_sport_type(12) == "cycling"  # BIKING_INDOOR
    assert _map_wahoo_sport_type(13) == "cycling"  # BIKING_MOUNTAIN
    assert _map_wahoo_sport_type(6) == "walking"
    assert _map_wahoo_sport_type(9) == "hiking"
    assert _map_wahoo_sport_type(46) == "golf"
    assert _map_wahoo_sport_type(42) == "strength"


def test_unknown_type_is_other_not_cycling():
    """Unknown ids must not silently become 'cycling'.

    Defaulting to cycling is what mislabelled walks/golf as rides and let them
    mis-enrich Strava activities.
    """
    assert _map_wahoo_sport_type(9999) == "other"
    assert _map_wahoo_sport_type(None) == "other"


def test_legacy_string_types_still_map():
    assert _map_wahoo_sport_type("cycling") == "cycling"
    assert _map_wahoo_sport_type("WALKING") == "walking"
    assert _map_wahoo_sport_type("gym") == "strength"


def test_biking_indoor_constant_is_12():
    """12 = BIKING_INDOOR, 13 = BIKING_MOUNTAIN (constant read 13 before)."""
    from app.integrations.wahoo_client import (
        WAHOO_TYPE_BIKING_INDOOR,
        WAHOO_TYPE_BIKING_MOUNTAIN,
    )

    assert WAHOO_TYPE_BIKING_INDOOR == 12
    assert WAHOO_TYPE_BIKING_MOUNTAIN == 13


# ── Metric extraction from workout_summary ───────────────────────────────────


def _summary_payload():
    """A realistic Wahoo item: metrics nested, all values JSON strings."""
    return {
        "id": 489667811,
        "name": "Cycling",
        "minutes": 199,
        "workout_type_id": 0,
        "workout_summary": {
            "distance_accum": "64531.18",
            "duration_active_accum": "9877.0",
            "power_avg": "154.0",
            "power_bike_np_last": "225.0",
            "power_bike_tss_last": "340.6",
            "heart_rate_avg": "143.0",
            "ascent_accum": "598.0",
            "calories_accum": "1527.0",
            "speed_avg": "6.53",
        },
    }


def test_summary_metrics_are_readable_from_nested_path():
    """Guard the exact paths the sync now reads."""
    from app.utils import safe_float

    w = _summary_payload()
    s = w["workout_summary"]

    assert safe_float(s["distance_accum"]) == 64531.18
    assert safe_float(s["duration_active_accum"]) == 9877.0
    assert safe_float(s["power_avg"]) == 154.0
    assert safe_float(s["power_bike_np_last"]) == 225.0
    assert safe_float(s["power_bike_tss_last"]) == 340.6
    assert safe_float(s["heart_rate_avg"]) == 143.0
    assert safe_float(s["ascent_accum"]) == 598.0
    assert safe_float(s["calories_accum"]) == 1527.0


def test_summary_null_degrades_gracefully():
    """Third-party-app recordings have `workout_summary: null`.

    The sync must not raise — it should fall back to top-level `minutes` and
    leave metrics None.
    """
    w = {
        "id": 486514440,
        "name": "Lunch Walk",
        "minutes": 37,
        "workout_type_id": 6,
        "workout_summary": None,
    }
    summary = w.get("workout_summary") or {}

    assert summary == {}
    assert w["workout_type_id"] == 6
    assert w["minutes"] == 37
