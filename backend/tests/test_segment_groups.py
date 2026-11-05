"""Pure geometry/naming tests for stable segment groups.

No database: ``build_profile`` and ``identity_key`` are the load-bearing pieces
for every profile a rider sees, so they are tested against a polyline with a
known gain rather than a fixture row.
"""

from __future__ import annotations

import uuid

import pytest

from app.models.route import Route
from app.services.climb_geocoding import area_from_address
from app.services.polyline_utils import encode_polyline
from app.services.segment_groups import (
    build_profile,
    canonical_name,
    clean_route_name,
    identity_key,
)


def _route(points, elevations) -> Route:
    return Route(
        user_id=uuid.uuid4(),
        name="Test climb",
        sport_type="cycling",
        distance_meters=1000.0,
        encoded_polyline=encode_polyline(points),
        start_lat=points[0][0],
        start_lng=points[0][1],
        end_lat=points[-1][0],
        end_lng=points[-1][1],
        is_loop=False,
        elevation_profile={"elevations": elevations},
    )


def test_clean_route_name_strips_import_suffixes():
    assert clean_route_name("The Stag (Long Route) - The Gralloch Sportive 2025") == (
        "The Stag (Long Route)"
    )
    assert clean_route_name(
        "Gladhouse Reservoir (North) – Gladhouse Reservoir loop from Edinburgh"
    ) == "Gladhouse Reservoir (North)"
    assert clean_route_name("Cramond Bridge – Hillhouse Hill (Bathgate Alps)") == (
        "Cramond Bridge – Hillhouse Hill (Bathgate Alps)"
    )
    # The short left clause is not substantial enough to stand alone.
    assert clean_route_name("Bonaly – Reservoir overflow") == "Bonaly – Reservoir overflow"


def test_identity_key_is_stable_direction_aware_and_quantised():
    a = identity_key(
        kind="climb",
        start_lat=55.96411,
        start_lng=-3.55501,
        end_lat=55.95561,
        end_lng=-3.55308,
        distance_m=953.2,
    )
    # A one-metre jitter must not create a second hill.
    b = identity_key(
        kind="climb",
        start_lat=55.96412,
        start_lng=-3.55502,
        end_lat=55.95562,
        end_lng=-3.55309,
        distance_m=953.4,
    )
    assert a == b
    # A different kind or the reverse direction is a different group.
    assert a != identity_key(
        kind="sprint",
        start_lat=55.96411,
        start_lng=-3.55501,
        end_lat=55.95561,
        end_lng=-3.55308,
        distance_m=953.2,
    )
    assert a != identity_key(
        kind="climb",
        start_lat=55.95561,
        start_lng=-3.55308,
        end_lat=55.96411,
        end_lng=-3.55501,
        distance_m=953.2,
    )


def test_build_profile_measures_a_known_climb():
    # 10 samples along a line ~690 m long, rising exactly 100 m.
    points = [(51.5, -0.1 + i * 0.001) for i in range(11)]
    elevations = [i * 10.0 for i in range(11)]
    route = _route(points, elevations)

    geom = build_profile(route, 0.0, route_distance(route))

    assert len(geom["profile"]) == 49
    assert len(geom["geometry"]) == 21
    assert 670 <= geom["distance_m"] <= 710
    assert 95 <= geom["gain_m"] <= 105
    assert 13 <= geom["avg_gradient_pct"] <= 16
    assert geom["profile"][0][0] == 0
    assert geom["profile"][-1][0] == geom["distance_m"]
    assert geom["max_gradient_pct"] > 10
    assert 0.0 <= geom["sustained_share"] <= 1.0
    # The first and last geometry samples are the window boundaries.
    assert geom["geometry"][0] == [51.5, -0.1]
    assert geom["geometry"][-1][1] > -0.199


def test_build_profile_is_empty_safe():
    route = Route(
        user_id=uuid.uuid4(),
        name="No geometry",
        sport_type="cycling",
        distance_meters=0,
        encoded_polyline="",
        start_lat=0,
        start_lng=0,
        end_lat=0,
        end_lng=0,
        is_loop=False,
    )
    geom = build_profile(route, 0, 1000)
    assert geom["profile"] == []
    assert geom["distance_m"] == 0
    assert geom["gain_m"] == 0


def test_canonical_name_never_leaks_a_generic_import_title():
    assert canonical_name("Cycling", 1, 1) == "Climb"
    assert canonical_name("Cycling", 2, 4) == "Climb 2"
    assert canonical_name("The Stag (Long Route)", 2, 4) == (
        "The Stag (Long Route) · climb 2"
    )


def test_area_from_address_prefers_the_human_place():
    assert area_from_address(
        {
            "suburb": "Balgreen",
            "city": "City of Edinburgh",
            "country": "United Kingdom",
        }
    ) == ("Balgreen", "Edinburgh", "United Kingdom")
    assert area_from_address(
        {"village": "Leschaux", "county": "Haute-Savoie", "country": "France"}
    ) == ("Leschaux", "Haute-Savoie", "France")
    assert area_from_address({}) == (None, None, None)


def route_distance(route: Route) -> float:
    """Cumulative metres along the test route (10 × ~69 m)."""
    from app.services.segment_groups import _route_axis

    dists, _, _ = _route_axis(route)
    return dists[-1]


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-q"])
