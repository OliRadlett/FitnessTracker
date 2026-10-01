"""Auto-merge must be off by default, because the plan says it is.

The plan is unambiguous: *"Auto-merge is off. No threshold is validated;
everything stays review-only."* But ``recompute_route_similarity`` merged
every ``tier == "auto"`` pair unconditionally — and on 28 Sep it silently
merged a route at score 0.826, with no review and no UI involvement.

The decision existed in prose while the code did the opposite. A design
decision that only lives in a document reverts the first time someone reads
the code rather than the plan, which is exactly what happened.

So: gate it on a setting that defaults to **off**, matching the plan. The
0.82 threshold stays — it defines what *would* be auto-merged if someone
later turns it on deliberately, which is the useful knob. The default is
the part that was wrong.

Reviewed duplicates stay visible either way: the graph is still written to
``route_similarity``, so pairs surface on the review page. Only the
unreviewed merge stops.
"""

from __future__ import annotations

import ast
from pathlib import Path

CONFIG_PY = Path(__file__).resolve().parents[1] / "app" / "config.py"
SCHEDULER_PY = Path(__file__).resolve().parents[1] / "app" / "tasks" / "scheduler.py"

_FN = (ast.FunctionDef, ast.AsyncFunctionDef)


def _find(tree, name, within=None):
    scope = ast.walk(within) if within is not None else ast.walk(tree)
    return next(n for n in scope if isinstance(n, _FN) and n.name == name)


class TestAutoMergeIsOffByDefault:
    def test_setting_exists_and_defaults_to_false(self):
        from app.config import Settings

        assert Settings().route_auto_merge_enabled is False, (
            "the plan records auto-merge as off; the default must agree, or "
            "the decision lives only in prose and reverts silently"
        )

    def test_task_auto_merge_is_gated_on_the_setting(self):
        fn = _find(
            ast.parse(SCHEDULER_PY.read_text(encoding="utf-8")),
            "_run",
            within=_find(
                ast.parse(SCHEDULER_PY.read_text(encoding="utf-8")),
                "recompute_route_similarity",
            ),
        )
        unparsed = ast.unparse(fn)
        assert "route_auto_merge_enabled" in unparsed, (
            "the auto-merge loop must check the setting; an unconditional "
            "merge contradicts the documented review-only decision"
        )

    def test_the_graph_is_still_written_when_auto_merge_is_off(self):
        """Turning off auto-merge must not turn off duplicate *detection*.

        These are separate decisions. The bug was never that merging
        happened; it was that detection and merging were wired together so
        refusing one took the other with it.
        """
        tree = ast.parse(SCHEDULER_PY.read_text(encoding="utf-8"))
        outer = _find(tree, "recompute_route_similarity")
        unparsed = ast.unparse(outer)
        assert "RouteSimilarity" in unparsed, (
            "pairs must still be cached for review when auto-merge is off"
        )

    def test_merge_loop_is_inside_the_gate(self):
        """A setting checked but not actually wrapping the merge is the worst
        outcome: it reads as compliant and behaves exactly as before."""
        tree = ast.parse(SCHEDULER_PY.read_text(encoding="utf-8"))
        fn = _find(tree, "_run", within=_find(tree, "recompute_route_similarity"))
        unparsed = ast.unparse(fn)
        gate = unparsed.index("route_auto_merge_enabled")
        merge = unparsed.index("merge_routes(")
        assert gate < merge, (
            "the setting is checked after the merge call, so it gates nothing"
        )

    def test_auto_threshold_is_preserved_as_the_if_enabled_knob(self):
        """Keep the 0.82 threshold: it defines what auto-merge *would* do."""
        from app.config import Settings

        assert Settings().route_match_auto_threshold == 0.82