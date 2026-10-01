"""Activities with no geometry must stop being retried forever.

``map_match_activities`` selects on ``road_match_version IS NULL`` and then
discovers, in Python, that some selected activities have no extractable
polyline. Those rows keep ``road_match_version`` NULL, so the *next* weekly
run selects them again, extracts nothing, and skips them again. On
production that was 15 activities, every week, indefinitely — and because
the skip is silent it looks like the task is simply doing nothing.

The fix is a third state for ``road_match_version``, not a new column:

    NULL  never attempted (the weekly task selects this)
    0     attempted, no geometry exists — do not retry
    1     matched, with the version-1 format

``ROAD_MATCH_VERSION`` is only ever compared against ``None`` anywhere in
the codebase, so 0 is free and unambiguous, and it survives the existing
merge/undo paths (a merge copies the duplicate's value, an undo resets to
NULL, which correctly means "try again").

Deliberately *not* a migration. Deciding an activity has no geometry means
running ``extract_activity_polyline``, which walks provider payload shapes
(``map.summary_polyline``, source-level fallbacks, top-level variants).
Encoding that rule as SQL would duplicate it in a second language and bind
a migration to provider payload details that change. Letting the task stamp
the rows keeps the rule in the one place that already knows it, and the
first run heals the backlog.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

SCHEDULER_PY = Path(__file__).resolve().parents[1] / "app" / "tasks" / "scheduler.py"
ROAD_MATCHING_PY = Path(__file__).resolve().parents[1] / "app" / "services" / "road_matching.py"


_FUNC = (ast.FunctionDef, ast.AsyncFunctionDef)


def _find(tree, name: str, within=None):
    """Locate a function by name, optionally scoped to an enclosing one.

    Scoping matters: ``scheduler.py`` defines a nested ``_run`` inside most
    of its tasks, so an unscoped name search returns whichever one comes
    first in the file rather than the one under test.
    """
    scope = ast.walk(within) if within is not None else ast.walk(tree)
    return next(n for n in scope if isinstance(n, _FUNC) and n.name == name)


def _fn(name: str, path: Path = SCHEDULER_PY, parent: str | None = None):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    outer = _find(tree, parent) if parent else None
    return _find(tree, name, within=outer)


class TestSentinelConstant:
    def test_no_geometry_version_is_distinct_from_a_real_match(self):
        from app.integrations.route_road_graph import ROAD_MATCH_VERSION
        from app.services.road_matching import ROAD_MATCH_VERSION_NO_GEOMETRY

        assert ROAD_MATCH_VERSION_NO_GEOMETRY == 0
        assert ROAD_MATCH_VERSION_NO_GEOMETRY != ROAD_MATCH_VERSION, (
            "the sentinel must not collide with a successful match, or a "
            "matched activity would be re-selected as unmatchable"
        )

    def test_sentinel_is_not_confused_with_never_attempted(self):
        """NULL means "never attempted"; the sentinel must not be falsy-NULL."""
        from app.services.road_matching import ROAD_MATCH_VERSION_NO_GEOMETRY

        assert ROAD_MATCH_VERSION_NO_GEOMETRY is not None


class TestTaskStampsUnmatchableActivities:
    def test_task_stamps_the_sentinel_on_skipped_activities(self):
        """The whole point: a skip has to leave a durable trace."""
        fn = _fn("_run", parent="map_match_activities")
        assert "ROAD_MATCH_VERSION_NO_GEOMETRY" in ast.unparse(fn), (
            "map_match_activities must stamp unmatchable activities so the "
            "weekly SELECT stops picking them up"
        )

    def test_selection_is_still_is_null(self):
        """Sentinel rows must stay out; only never-attempted rows are selected."""
        fn = _fn("_run", parent="map_match_activities")
        refs = [
            ast.unparse(n)
            for n in ast.walk(fn)
            if isinstance(n, ast.Attribute)
            and n.attr == "road_match_version"
            and isinstance(n.value, (ast.Name, ast.Attribute))
        ]
        assert refs, "expected the task to filter on road_match_version"
        assert not any("is_not" in r or "!=" in r for r in refs), (
            "road_match_version should be filtered with IS NULL; the sentinel "
            "is excluded by being non-NULL"
        )


class TestSentinelDoesNotDisturbOtherPaths:
    def test_successful_match_still_writes_the_real_version(self):
        fn_src = ast.unparse(_fn("store_activity_road_matches", ROAD_MATCHING_PY))
        assert "ROAD_MATCH_VERSION" in fn_src
        assert "ROAD_MATCH_VERSION_NO_GEOMETRY" not in fn_src, (
            "a successful match must record the real version, never the "
            "no-geometry sentinel"
        )

    def test_merge_copies_the_sentinel_so_a_merged_duplicate_stays_skipped(self):
        """Merge already copies ``road_match_version`` from the duplicate.

        Copying is correct here: the geometry didn't exist before the merge
        and still doesn't, so re-attempting would just re-skip.
        """
        src = (
            Path(__file__).resolve().parents[1]
            / "app"
            / "services"
            / "route_service.py"
        ).read_text(encoding="utf-8")
        assert '"road_match_version": duplicate.road_match_version' in src

    def test_undo_resets_to_null_so_a_route_can_be_retried(self):
        """Undo must clear the sentinel, or a merge-undo strands the route."""
        src = (
            Path(__file__).resolve().parents[1]
            / "app"
            / "services"
            / "route_service.py"
        ).read_text(encoding="utf-8")
        assert "road_match_version = None" in src
