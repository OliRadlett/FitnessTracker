"""The review queue must carry enough geometry to *show* the routes.

Containment and Jaccard are two numbers; they answer "how much do these
overlap" but not "what do these look like". Judging whether an orphan is
a lap of a course or a partial recording of it is a visual judgement —
the overlay map is what makes it one. So the queue has to ship polylines.

Two failure modes this guards, both of which produce a UI that renders
plenty of confident numbers and an empty box where the map should be:

1. ``list_review_queue`` selects id/name/road_match and forgets
   ``encoded_polyline``. Nothing raises; the rows are simply useless.
2. The live candidate's polyline is missing, so the overlay has nothing
   to draw for the route being compared *against*.

Also asserted: the response must not carry polylines for live routes that
were not matched to anything. The ranking runs before we know which live
routes matter, and selecting every live polyline up front would ship
~80 routes' geometry to use ~56 of them.
"""

from __future__ import annotations

import ast
from pathlib import Path

SCHEMAS_PY = Path(__file__).resolve().parents[1] / "app" / "schemas" / "route.py"
SERVICE_PY = Path(__file__).resolve().parents[1] / "app" / "services" / "route_quarantine.py"


def _class_body(tree: ast.AST, name: str) -> list[ast.stmt]:
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == name:
            return node.body
    raise AssertionError(f"class {name} not found")


def _annotated_fields(path: Path, class_name: str) -> dict[str, ast.expr]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: dict[str, ast.expr] = {}
    for stmt in _class_body(tree, class_name):
        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            out[stmt.target.id] = stmt.annotation
    return out


def test_row_schema_declares_both_polylines():
    fields = _annotated_fields(SCHEMAS_PY, "OrphanReviewRow")
    assert "orphan_polyline" in fields, "the orphan's own trace is needed to draw it"
    assert "live_polyline" in fields, (
        "the candidate's trace is needed too — an overlay with one line is "
        "not a comparison"
    )


def test_live_polyline_is_optional_because_a_candidate_may_not_exist():
    """11 of 67 orphans have no live candidate at all.

    Their polyline must be nullable, or the response fails validation and
    the whole queue 500s instead of listing the rows that *do* have a match.
    """
    fields = _annotated_fields(SCHEMAS_PY, "OrphanReviewRow")
    ann = ast.unparse(fields["live_polyline"])
    assert "None" in ann, f"live_polyline must be nullable, got {ann!r}"


def test_row_schema_carries_distances_for_both_sides():
    """A lap is defined by being *shorter*.

    Without both distances the row cannot show the one fact that
    distinguishes "duplicate" from "lap of a longer course".
    """
    fields = _annotated_fields(SCHEMAS_PY, "OrphanReviewRow")
    assert "orphan_distance_m" in fields
    assert "live_distance_m" in fields


def _executes(fn: ast.AsyncFunctionDef) -> list[str]:
    """Unparsed ``db.execute(...)`` calls, each with its own ``select``/``where``.

    Classifying at the ``execute`` level rather than at ``select(...)`` matters:
    the live-route query is identified by ``active_routes_clause()``, which
    lives in the sibling ``.where()``, so inspecting the select call alone
    cannot tell the two queries apart.
    """
    return [
        ast.unparse(n)
        for n in ast.walk(fn)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "execute"
    ]


def _queue_fn() -> ast.AsyncFunctionDef:
    tree = ast.parse(SERVICE_PY.read_text(encoding="utf-8"))
    return next(
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "list_review_queue"
    )


def test_queue_selects_the_orphan_polyline():
    """The specific regression: forget the column, get a silent empty map."""
    assert any("encoded_polyline" in q for q in _executes(_queue_fn())), (
        "list_review_queue must select Route.encoded_polyline — without it "
        "the rows carry numbers and an empty map"
    )


def test_queue_does_not_select_every_live_polyline_up_front():
    """Live polylines are fetched only for routes that were actually matched.

    The ranking needs id/name/road_match for all live routes, but shipping
    every live polyline would put ~80 routes' geometry on the wire to use
    roughly 56 of them.
    """
    queries = _executes(_queue_fn())
    live = [q for q in queries if "active_routes_clause" in q]
    assert live, "expected a query for the live (matchable) routes"
    assert not any("encoded_polyline" in q for q in live), (
        "the live candidate query must not select encoded_polyline — matched "
        "candidates are fetched afterwards, only for the ones actually used"
    )


def test_unscorable_rows_still_carry_their_own_polyline():
    """No geometry to *compare* does not mean no geometry to *show*.

    An orphan with no ``road_match`` is unscorable, but its trace still
    renders — that is how the user tells whether it deserves a manual
    road match rather than a dismissal.
    """
    fields = _annotated_fields(SCHEMAS_PY, "OrphanReviewRow")
    ann = ast.unparse(fields["orphan_polyline"])
    assert "None" not in ann, (
        f"orphan_polyline must be required, got {ann!r}: has_geometry=False "
        "means no road_match, not no polyline"
    )
