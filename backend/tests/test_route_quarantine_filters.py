"""Every candidate query must apply the quarantine filter.

``test_route_quarantine.py`` proves the predicate is correct. It cannot
prove the predicate is *used* — a perfect, never-called filter passes
every test there. That gap is the real risk: there are a dozen
``select(Route)`` sites in this codebase, most of which are display paths
that must NOT be filtered, and getting the split wrong is silent in both
directions.

So the split is asserted explicitly:

  FILTERED  — matching paths. A quarantined route must never be a
              candidate, or the sweep achieves nothing.
  UNFILTERED — display paths. A quarantined route is still the user's
              route; hiding it would lose their data.

Both lists are checked by parsing the source for the
``active_routes_clause()`` call, so a new matching query that forgets the
filter fails here rather than in production.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]

# Query sites that select routes *as matching candidates*. Each must apply
# the quarantine filter.
MUST_FILTER = [
    # Activity -> course linking, both the single and the backfill path.
    "app/services/merge_service.py",
    # Route -> route duplicate detection, which is what created the orphans.
    "app/services/route_service.py",
    # Batch route fetch during Strava sync, used for linking.
    "app/services/strava/sync.py",
    # Similarity-metric training: quarantined routes must stay out of the
    # negatives pool or they teach the matcher that real courses are dupes.
    "app/services/road_matching.py",
    # Smart collection rules match routes against user rules.
    "app/services/route_collection_rules.py",
]

# Query sites that must keep showing quarantined routes.
MUST_NOT_FILTER = [
    "app/api/routes.py",
    "app/api/search.py",
]


def _calls_filter(path: Path) -> bool:
    source = path.read_text(encoding="utf-8")
    if "active_routes_clause" not in source:
        return False
    tree = ast.parse(source)
    return any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "active_routes_clause"
        for node in ast.walk(tree)
    )


def _imports_filter(path: Path) -> bool:
    source = path.read_text(encoding="utf-8")
    if "route_quarantine" not in source:
        return False
    tree = ast.parse(source)
    return any(
        isinstance(node, ast.ImportFrom)
        and (node.module or "").endswith("route_quarantine")
        and any(a.name == "active_routes_clause" for a in node.names)
        for node in ast.walk(tree)
    )


@pytest.mark.parametrize("module_path", MUST_FILTER)
def test_matching_query_filters_quarantined_routes(module_path: str):
    path = BACKEND / module_path
    assert path.exists(), module_path
    assert _imports_filter(path), (
        f"{module_path} selects routes as matching candidates but does not "
        "import active_routes_clause. A quarantined route that is still a "
        "candidate defeats the whole sweep."
    )
    assert _calls_filter(path), (
        f"{module_path} imports active_routes_clause but never calls it"
    )


@pytest.mark.parametrize("module_path", MUST_NOT_FILTER)
def test_display_query_still_shows_quarantined_routes(module_path: str):
    """A quarantined route is still the user's route.

    Filtering the list endpoint would make a reversible quarantine look
    like data loss, which is precisely the fear that makes an operator
    avoid running the sweep at all.
    """
    path = BACKEND / module_path
    assert path.exists(), module_path
    assert not _calls_filter(path), (
        f"{module_path} is a display path and must not hide quarantined routes"
    )


def test_clause_itself_is_a_null_check():
    """Guards the property the whole design rests on.

    ``quarantined_at IS NULL`` is what makes the column additive: existing
    rows are automatically active, so deploying the migration changes no
    behaviour and only an explicit sweep quarantines anything.
    """
    import inspect

    from app.services.route_quarantine import active_routes_clause

    clause = str(active_routes_clause())
    assert "quarantined_at IS NULL" in clause
    # A NOT NULL equality would make every existing route quarantined.
    assert "NOT NULL" not in clause
    assert inspect.signature(active_routes_clause).parameters == {}
