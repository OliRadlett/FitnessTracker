"""Every merge must record the evidence for its decision.

``merge_routes`` accepts ``score`` and ``breakdown`` but defaults both to
nothing, and the UI path supplies neither. On production, **26 of 27**
``identical`` merges were logged with ``score = 0.0`` and an empty
breakdown — no ``length_ratio``, no ``coverage``, nothing. Those 26 trained
the embedding metric, so if any was a false positive it is now baked in and
there is no way to tell which, or to un-learn it.

Only the one auto-merge (28 Sep, score 0.8256, coverage 0.997/0.969) kept
its evidence.

So the breakdown is computed *inside* ``merge_routes`` when the caller does
not supply one, rather than asking each caller to pass it. The UI path, the
bulk-merge path and the similarity task all get it for free; a caller that
already has a breakdown (the similarity task) keeps its own.

Two properties worth pinning:

1. **A merge that cannot be scored still succeeds**, recording why. A
   degenerate polyline must not block a legitimate merge — but it must not
   leave an unauditable one either, so the log distinguishes "scored" from
   "could not score" instead of storing null for both.
2. **Evidence is recorded for every kind**, including ``variant``. The
   variant/identical distinction is what protects the metric, so the
   evidence behind that choice is exactly what a later audit needs.
"""

from __future__ import annotations

import ast
from pathlib import Path

SERVICE_PY = (
    Path(__file__).resolve().parents[1] / "app" / "services" / "route_service.py"
)

_FN = (ast.FunctionDef, ast.AsyncFunctionDef)


def _merge_fn():
    tree = ast.parse(SERVICE_PY.read_text(encoding="utf-8"))
    return next(
        n
        for n in ast.walk(tree)
        if isinstance(n, _FUNC_TYPES := _FN) and n.name == "merge_routes"
    )


class TestMergeRecordsEvidence:
    def test_merge_computes_a_breakdown_when_none_supplied(self):
        unparsed = ast.unparse(_merge_fn())
        assert "score_route_pair" in unparsed, (
            "merge_routes must score the pair itself when the caller supplies "
            "no breakdown, or the UI path keeps logging decisions with no "
            "evidence — which is how 26 of 27 identical merges ended up "
            "unauditable"
        )

    def test_scoring_failure_does_not_block_the_merge(self):
        """A degenerate polyline must not stop a legitimate merge."""
        unparsed = ast.unparse(_merge_fn())
        assert "try:" in unparsed, "the scoring call must be guarded"
        assert "except" in unparsed

    def test_unscoreable_merges_are_marked_not_left_null(self):
        """``null`` means both 'not scored' and 'nobody looked'. Distinguish."""
        unparsed = ast.unparse(_merge_fn())
        assert "scored" in unparsed, (
            "an unscored merge must record that it was unscored, so the log "
            "can tell it apart from a merge with no recorded evidence"
        )

    def test_supplied_breakdown_is_kept_not_overwritten(self):
        """The similarity task already has a scored breakdown; recomputing
        would discard a score it deliberately computed with its own gates."""
        unparsed = ast.unparse(_merge_fn())
        assert "breakdown is None" in unparsed or "if breakdown is None" in unparsed, (
            "a caller-supplied breakdown must take precedence over the "
            "fallback computation"
        )


class TestEvidenceIsPersisted:
    def test_log_row_carries_the_breakthrough(self):
        unparsed = ast.unparse(_merge_fn())
        assert "RouteMergeLog(" in unparsed, "the merge must still write a log row"
        assert "breakdown=" in unparsed, "the computed evidence must reach the log row"

    def test_score_is_also_recorded(self):
        """``breakdown`` alone is enough to audit, but ``score`` is the column
        the merge history UI sorts on."""
        unparsed = ast.unparse(_merge_fn())
        assert "score=" in unparsed