"""``create_or_merge_route`` must not adopt an unrelated ride's geometry.

The "richer geometry wins" rule compares **point counts only**. Its premise
is that both polylines describe the same route at different resolutions —
true when the provider route id matched correctly, false when sync matched
the wrong row.

On production that premise failed. Two routes were found whose canonical
polyline matched **no** of their own sources, by margins of 21% and 28%:

    78c87db1  Queensferry loop short   canon 3892  own source 3549
    cff23b68  The Granites – B7007     canon 7050  own source 5481

The adopted geometry came from a *different ride*. Because the swap happened
before similarity scoring, the route was then compared against the ride that
stole its geometry, and scored coverage 1.0 / Fréchet 1.0 / detour 0 — a
100% auto-match between two routes on opposite sides of a city. Both were
quarantined, which is the only reason they surfaced at all.

Point count alone cannot distinguish "same route, better resolution" from
"different route, more points". Overlap can, and cheaply: two recordings of
one route cover each other; two different routes do not.

The guard requires the incoming polyline to cover the existing one before
adopting. Adoption is the rare case — it exists for a genuine re-sync at
higher resolution — so a conservative threshold costs nothing real.
"""

from __future__ import annotations

import ast
from pathlib import Path

SERVICE_PY = (
    Path(__file__).resolve().parents[1] / "app" / "services" / "route_service.py"
)

_FN = (ast.FunctionDef, ast.AsyncFunctionDef)


def _fn(name: str):
    tree = ast.parse(SERVICE_PY.read_text(encoding="utf-8"))
    return next(
        n for n in ast.walk(tree) if isinstance(n, _FN) and n.name == name
    )


def _line(n: int, spacing_deg: float, start_lat: float = 55.90, lng: float = -3.20):
    """A straight run of ``n`` samples spaced ``spacing_deg`` apart."""
    return [(start_lat + i * spacing_deg, lng) for i in range(n)]


class TestAdoptionRequiresOverlap:
    def test_adoption_is_guarded_by_an_overlap_check(self):
        unparsed = ast.unparse(_fn("create_or_merge_route"))
        assert "_polyline_matches(" in unparsed, (
            "adopting geometry must be gated on overlap; a point-count "
            "comparison cannot tell a re-resolution from a different ride"
        )

    def test_the_helper_actually_measures_overlap(self):
        unparsed = ast.unparse(_fn("_polyline_matches"))
        assert "coverage" in unparsed, "the guard must use the coverage metric"
        assert "ADOPT_MIN_OVERLAP" in unparsed, (
            "the overlap threshold must be a named constant so its value is "
            "visible and adjustable, not an inline literal"
        )

    def test_threshold_is_strict_enough_to_reject_a_different_route(self):
        from app.services.route_service import ADOPT_MIN_OVERLAP

        assert 0.5 <= ADOPT_MIN_OVERLAP <= 0.95, (
            "below 0.5 a route sharing one corner could still hijack a "
            "polyline; above 0.95 a genuine re-resolution would be refused"
        )

    def test_geometry_is_not_swapped_when_overlap_is_absent(self):
        """The failure itself: two routes 20 km apart sharing a start point."""
        from app.services.route_matching import coverage

        # Same construction as test_coverage_containment, which is known to
        # behave; only the longitude differs, so the two run east and west
        # from a shared start.
        shared = _line(3, 1 / 1000)
        east = shared + _line(120, 1 / 1000, start_lat=55.95, lng=-3.24)[3:]
        west = shared + _line(120, 1 / 1000, start_lat=55.95, lng=-3.49)[3:]

        a = coverage(east, west, 40.0)
        b = coverage(west, east, 40.0)
        assert max(a, b) < 0.5, (
            f"diverging routes share {a:.2f}/{b:.2f} overlap — if this were "
            "high, the guard could not distinguish them"
        )


class TestTheRuleStillDoesItsJob:
    def test_a_higher_resolution_resync_still_adopts(self):
        """The guard must not break the behaviour it protects."""
        from app.services.route_matching import coverage

        coarse = _line(101, 60.0 / 111_320.0)
        dense = _line(201, 30.0 / 111_320.0)
        assert coverage(coarse, dense, 40.0) > 0.9
        assert coverage(dense, coarse, 40.0) > 0.9