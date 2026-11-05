"""Unit tests for the display-only polyline preview used by the routes list.

The list response carries a decimated shape so cards and the atlas map can draw
a route without shipping full geometry. These tests pin the contract: bounded
point count, endpoints preserved, short polylines untouched, bad input nulled.
"""

import math

from app.services.polyline_utils import (
    decode_polyline,
    encode_polyline,
    preview_polyline,
)


def _long_polyline(points: int = 600) -> str:
    coords = [
        (51.5 + math.sin(i / 20) * 0.02, -0.12 + i * 0.0004) for i in range(points)
    ]
    return encode_polyline(coords)


def test_long_polyline_is_decimated_to_the_cap():
    encoded = _long_polyline(600)
    preview = preview_polyline(encoded, max_points=90)

    assert preview is not None
    points = decode_polyline(preview)
    assert len(points) <= 90
    # A silhouette, not a stub: most of the budget is used.
    assert len(points) >= 80


def test_preview_preserves_both_endpoints():
    encoded = _long_polyline(600)
    original = decode_polyline(encoded)
    preview = decode_polyline(preview_polyline(encoded, max_points=90) or "")

    assert preview[0] == original[0]
    assert preview[-1] == original[-1]


def test_short_polyline_is_returned_unchanged():
    encoded = encode_polyline([(51.5, -0.1), (51.51, -0.11), (51.52, -0.12)])

    assert preview_polyline(encoded) == encoded


def test_missing_polyline_returns_none():
    assert preview_polyline(None) is None
    assert preview_polyline("") is None


def test_corrupt_polyline_returns_none_instead_of_raising():
    # A single terminator byte decodes a latitude and then runs out of input.
    assert preview_polyline("?") is None


def test_payload_shrinks():
    encoded = _long_polyline(600)
    preview = preview_polyline(encoded, max_points=90)

    assert preview is not None
    assert len(preview) < len(encoded) / 2
