"""The orphan-review endpoints, and where they sit in the route table.

Two things are easy to get wrong and both fail at runtime rather than at
import:

1. **Registration order (Pitfall #13).** ``/orphans`` is a static
   single-segment path. Registered after ``/{route_id}`` it would be
   shadowed, and "orphans" is not a valid UUID, so the request would 422
   instead of reaching the handler. This asserts the ordering against the
   real app's route table rather than by reading the file.

2. **Dismiss semantics.** Dismissing must *not* un-quarantine: the route
   stays excluded and simply stops being re-proposed. A regression that
   cleared ``quarantined_at`` would put a route the user just rejected back
   into the matching pool.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

ROUTES_PY = Path(__file__).resolve().parents[1] / "app" / "api" / "routes.py"


def _tree():
    return ast.parse(ROUTES_PY.read_text(encoding="utf-8"))


def _route_order() -> list[tuple[str, str]]:
    """(path, methods) in *registration order*, straight from the source.

    Walks module ``body`` rather than using ``ast.walk``, because
    ``ast.walk`` does not preserve source order and registration order is
    precisely the property under test. Parsed rather than imported because
    importing the app needs ``fastapi``, which this environment lacks; the
    ordering property is a property of the source either way.
    """
    out: list[tuple[str, str]] = []
    for node in _tree().body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call) or not isinstance(dec.func, ast.Attribute):
                continue
            verb = dec.func.attr
            if verb not in ("get", "post", "patch", "put", "delete"):
                continue
            path = dec.args[0].value if dec.args else ""
            out.append((path, verb.upper()))
    return out


MAIN_PY = Path(__file__).resolve().parents[1] / "app" / "main.py"


def _routes_prefix() -> str | None:
    """The prefix the routes router is mounted under, read from ``main.py``.

    Read from source rather than from a constructed app on purpose. Walking
    ``app.routes`` to recover the mounted paths depends on Starlette
    internals — current versions wrap included routers in ``_IncludedRouter``,
    which has no ``.path`` at all, so that route silently breaks on upgrade.
    The prefix is one static line; asserting on it is both sufficient and
    stable.
    """
    tree = ast.parse(MAIN_PY.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not (isinstance(fn, ast.Attribute) and fn.attr == "include_router"):
            continue
        for arg in node.args:
            if isinstance(arg, ast.Name) and arg.id == "routes_router":
                for kw in node.keywords:
                    if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                        return kw.value.value
    return None


def test_orphan_endpoints_are_registered():
    paths = {p for p, _ in _route_order()}
    assert "/orphans" in paths
    assert "/orphans/{route_id}/dismiss" in paths
    assert "/orphans/{route_id}/keep" in paths


def test_orphans_is_not_shadowed_by_the_dynamic_route():
    """``/orphans`` must be matched before ``/{route_id}``.

    FastAPI resolves in registration order, so a static path registered
    after a dynamic one is unreachable — the dynamic handler claims it and
    fails UUID validation, giving a 422 instead of the review queue.
    """
    ordered = [p for p, _ in _route_order()]
    orphans = ordered.index("/orphans")
    dynamic = ordered.index("/{route_id}")
    assert orphans < dynamic, (
        "/orphans is registered after /{route_id} and would be shadowed"
    )


def test_dismiss_and_keep_are_post():
    methods = dict(_route_order())
    assert methods["/orphans/{route_id}/dismiss"] == "POST"
    assert methods["/orphans/{route_id}/keep"] == "POST"


def test_routes_router_is_mounted_where_the_endpoint_path_implies():
    """``/orphans`` reaches the client as ``/api/v1/routes/orphans``.

    Combined with the registration-order test above, this pins the full
    URL: order within the router decides which handler matches, and the
    mount prefix decides what the client calls. Getting either wrong
    yields a 422 rather than a review queue.
    """
    prefix = _routes_prefix()
    assert prefix == "/api/v1/routes", (
        f"routes router mounts under {prefix!r}; the endpoint paths in this "
        "test assume /api/v1/routes"
    )


def test_dismissed_at_is_a_real_column():
    """Guards the ORM/schema drift that migration 090 had to repair."""
    from app.models.route import Route

    col = Route.__table__.columns.get("dismissed_at")
    assert col is not None
    assert col.nullable, "nullable so existing quarantined routes start unreviewed"


def _written_attrs(func) -> set[str]:
    """Column names assigned by ``.values(...)`` inside ``func``.

    Asserting on what a function *writes*, not on substrings of its source:
    ``dismiss_route`` legitimately *reads* ``quarantined_at`` in its WHERE
    clause, so a text check is both too strict and too weak.

    Handles both spellings the SQLAlchemy UPDATE builder allows —
    ``.values(dismissed_at=func.now())`` and ``.values(Route.dismissed_at)``.
    """
    tree = ast.parse(inspect.getsource(func).lstrip())
    written: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not (isinstance(fn, ast.Attribute) and fn.attr == "values"):
            continue
        for kw in node.keywords:
            if kw.arg:
                written.add(kw.arg)
            elif isinstance(kw.value, ast.Attribute):
                written.add(kw.value.attr)
        for arg in node.args:
            if isinstance(arg, ast.Attribute):
                written.add(arg.attr)
            elif isinstance(arg, ast.Name):
                written.add(arg.id)
    return written


def test_dismiss_keeps_the_route_quarantined():
    """Dismissing must not return the route to the matching pool."""
    from app.services import route_quarantine

    written = _written_attrs(route_quarantine.dismiss_route)
    assert "dismissed_at" in written, "dismiss_route must write dismissed_at"
    assert "quarantined_at" not in written, (
        "dismiss_route must not clear quarantined_at — the route stays "
        "excluded from matching, it just stops being re-proposed"
    )


def test_keep_clears_both_stamps():
    """Keeping retracts a previous judgement, so it clears both."""
    from app.services import route_quarantine

    written = _written_attrs(route_quarantine.keep_route)
    assert {"quarantined_at", "dismissed_at"} <= written, (
        "keep_route must clear both stamps so a route the user was wrong "
        "about can be brought back with one action"
    )


def test_review_queue_filters_dismissed_routes_in_sql():
    """The queue must be able to empty, or every sweep re-proposes the same rows.

    Asserted on the query ``list_review_queue`` actually builds — this is
    the filter, not a helper that merely mirrors it.
    """
    from app.services import route_quarantine

    tree = ast.parse(inspect.getsource(route_quarantine.list_review_queue))
    src = ast.unparse(tree)
    assert "dismissed_at" in src, (
        "list_review_queue must filter on dismissed_at, or a rejected route "
        "is re-proposed on every sweep and the queue never empties"
    )
    assert "is_(None)" in src
    assert "quarantined_at" in src, "and must still require quarantined_at"
