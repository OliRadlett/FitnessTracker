"""Komoot surface extraction — the shapes the API actually sends.

The v007 tour payload stores ``summary.surfaces`` as a LIST of
``{"type": "sb#asphalt", "amount": 1.0}``. The first implementation only
accepted a dict keyed by surface name and read ``percentage/share/value``, so
every real tour returned None and ``routes.surface_profile`` stayed empty for
the whole account despite the data being present in the stored payload.
"""

from app.services.komoot import _extract_surface_profile


def test_real_tour_payload_shape():
    payload = {
        "summary": {
            "surfaces": [
                {"type": "sb#compacted", "amount": 0.0024603135},
                {"type": "sb#paved", "amount": 0.23898634},
                {"type": "sb#asphalt", "amount": 0.7585533},
            ]
        }
    }
    profile = _extract_surface_profile(payload)

    assert profile == {"compacted_gravel": 0.0025, "paved": 0.9975}


def test_single_surface_tour():
    payload = {"summary": {"surfaces": [{"type": "sb#asphalt", "amount": 1.0}]}}

    assert _extract_surface_profile(payload) == {"paved": 1.0}


def test_percentage_items_are_normalised():
    payload = {
        "surfaces": [
            {"type": "asphalt", "percentage": 60},
            {"type": "gravel", "percentage": 40},
        ]
    }

    assert _extract_surface_profile(payload) == {"gravel": 0.4, "paved": 0.6}


def test_dict_shapes_still_work():
    assert _extract_surface_profile(
        {"surfaces": {"asphalt": 0.6, "gravel": 0.4}}
    ) == {"paved": 0.6, "gravel": 0.4}
    assert _extract_surface_profile({"data": {"asphalt": 60, "gravel": 40}}) == {
        "paved": 0.6,
        "gravel": 0.4,
    }
    assert _extract_surface_profile({"asphalt": 0.6}) == {"paved": 1.0}


def test_unknown_and_way_types_are_skipped():
    payload = {
        "summary": {
            "surfaces": [
                {"type": "sf#unknown", "amount": 0.1},
                {"type": "wt#cycleway", "amount": 0.2},
                {"type": "sb#paved", "amount": 0.7},
            ]
        }
    }

    assert _extract_surface_profile(payload) == {"paved": 1.0}


def test_zero_and_empty_inputs_return_none():
    assert _extract_surface_profile(None) is None
    assert _extract_surface_profile({}) is None
    assert _extract_surface_profile({"summary": {"surfaces": []}}) is None
    assert _extract_surface_profile(
        {"summary": {"surfaces": [{"type": "sb#paved", "amount": 0}]}}
    ) is None
