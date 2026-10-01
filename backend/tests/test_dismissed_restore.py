"""Dismissed routes must be listable and restorable.

``keep_route`` was written to reverse a dismissal — it clears both stamps.
But the review queue selects on ``dismissed_at IS NULL``, so a dismissed
route never appears, and that queue is the only surface offering **Keep**.
The reversal existed and was unreachable, which makes dismissal a one-way
door through the UI.

That is not a hypothetical: 49 of the queue's rows were dismissed in bulk,
and a dismissed route is exactly what a bulk mistake produces. Finding one
required knowing its id.

This is the same class of problem as the stale-count guard on bulk
dismiss — the destructive action needs its reversal visible next to it.

Two properties worth asserting separately:

1. **Dismissed routes are listed**, otherwise there is nothing to restore
   from.
2. **Restore reaches a *dismissed* route specifically.** Reusing the
   single-row Keep endpoint is right (it already clears both stamps), but
   the failure mode to guard is the list silently returning quarantined-not-
   dismissed routes instead, which would look like the feature working.
"""

from __future__ import annotations

import ast
from pathlib import Path

SERVICE_PY = Path(__file__).resolve().parents[1] / "app" / "services" / "route_quarantine.py"
API_PY = Path(__file__).resolve().parents[1] / "app" / "api" / "routes.py"
SCHEMAS_PY = Path(__file__).resolve().parents[1] / "app" / "schemas" / "route.py"

_FN = (ast.FunctionDef, ast.AsyncFunctionDef)


def _find(tree, name, within=None):
    scope = ast.walk(within) if within is not None else ast.walk(tree)
    return next(n for n in scope if isinstance(n, _FN) and n.name == name)


class TestDismissedRoutesAreListable:
    def test_service_exposes_a_dismissed_listing(self):
        tree = ast.parse(SERVICE_PY.read_text(encoding="utf-8"))
        names = {n.name for n in ast.walk(tree) if isinstance(n, _FN)}
        assert any("dismissed" in n for n in names), (
            f"expected a dismissed-routes listing, found {sorted(names)}"
        )

    def test_listing_filters_on_dismissed_not_null(self):
        """The whole feature. Selecting the wrong side of the flag would
        return the pending queue instead and look like it worked."""
        tree = ast.parse(SERVICE_PY.read_text(encoding="utf-8"))
        fns = [
            n
            for n in ast.walk(tree)
            if isinstance(n, _FN)
            and "dismissed" in n.name
            and "list" in n.name
        ]
        assert fns, "expected a list_dismissed_* function"
        unparsed = "\n".join(ast.unparse(n) for n in fns)
        assert "dismissed_at.isnot(None)" in unparsed.replace(" ", ""), (
            "the listing must select dismissed rows, not pending ones"
        )

    def test_listing_keeps_the_route_name_and_stamp(self):
        """A restore list with no names is a list of ids."""
        tree = ast.parse(SERVICE_PY.read_text(encoding="utf-8"))
        fns = [
            n
            for n in ast.walk(tree)
            if isinstance(n, _FN)
            and "dismissed" in n.name
            and "list" in n.name
        ]
        unparsed = "\n".join(ast.unparse(n) for n in fns)
        assert "name" in unparsed
        assert "dismissed_at" in unparsed


class TestRestoreReachesDismissedRoutes:
    def test_keep_endpoint_exists_and_is_not_quarantined_gated(self):
        """``keep_route`` has no quarantine precondition, so it can restore
        a dismissed route. Asserted so a future tightening does not quietly
        make dismissal permanent again."""
        fn = _find(ast.parse(SERVICE_PY.read_text(encoding="utf-8")), "keep_route")
        unparsed = ast.unparse(fn)
        assert "quarantined_at.isnot(None)" not in unparsed, (
            "keep_route must not require the route to be quarantined — that "
            "is what lets it restore an already-dismissed row"
        )
        assert "dismissed_at=None" in unparsed.replace(" ", "")

    def test_dismissed_listing_is_served_by_an_endpoint(self):
        src = API_PY.read_text(encoding="utf-8")
        assert '"/orphans/dismissed"' in src, (
            "expected GET /routes/orphans/dismissed"
        )

    def test_endpoint_precedes_the_dynamic_route_id(self):
        """Pitfall #13. ``/orphans/dismissed`` is a static path and
        ``PATCH /{route_id}`` sits mid-file ready to shadow it."""
        tree = ast.parse(API_PY.read_text(encoding="utf-8"))
        order: list[str] = []
        for node in tree.body:
            if not isinstance(node, _FN):
                continue
            for dec in node.decorator_list:
                if (
                    isinstance(dec, ast.Call)
                    and isinstance(dec.func, ast.Attribute)
                    and dec.func.attr in ("get", "post", "patch", "put", "delete")
                ):
                    order.append(dec.args[0].value if dec.args else "")
        target = "/orphans/dismissed"
        assert target in order, "endpoint not found in decorator order"
        assert order.index(target) < order.index("/{route_id}"), (
            "/orphans/dismissed is registered after /{route_id} and shadowed"
        )

    def test_response_schema_carrows_name_and_stamp(self):
        tree = ast.parse(SCHEMAS_PY.read_text(encoding="utf-8"))
        names = {
            n.name
            for n in ast.walk(tree)
            if isinstance(n, ast.ClassDef) and "Dismiss" in n.name
        }
        assert names, "expected a dismissed-routes response schema"
        cls = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.ClassDef) and "Dismissed" in n.name and "Row" in n.name
        )
        fields = {
            s.target.id
            for s in cls.body
            if isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name)
        }
        assert "route_id" in fields or "id" in fields
        assert "name" in fields
        assert "dismissed_at" in fields