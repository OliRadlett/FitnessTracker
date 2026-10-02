"""The two Komoot ingestion loops must be disjoint, and say what they are.

``get_routes()`` filters ``type=tour_planned``. ``get_tours()`` was called
with no filter at all, so it also returned every planned route — the planned
loop was a strict subset of what the recorded loop already fetched. Both then
ingested the same object, under two different provider ids, because the
planned loop decorated the id with a ``route_`` prefix. Two rows per tour.

Twelve tours ended up stored twice that way. Nine of the twelve duplicates
were created by a single 18:00 sync, and in eight of them the live row was
the newer one, meaning a merge the user had already performed was silently
reverted.

These are static and API-shape assertions. The behavioural proof that a
re-sync no longer regrows a twin is in
``tests/integration/test_identical_geometry_dedupe.py``; what is asserted
here is that the two call sites cannot silently converge again.
"""

from __future__ import annotations

import ast
from pathlib import Path

SERVICE = Path(__file__).resolve().parents[1] / "app" / "services" / "komoot.py"
CLIENT = Path(__file__).resolve().parents[1] / "app" / "integrations" / "komoot_client.py"

_FN = (ast.FunctionDef, ast.AsyncFunctionDef)


def _functions(path: Path) -> dict[str, ast.AST]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {n.name: n for n in ast.walk(tree) if isinstance(n, _FN)}


def _call_keywords(func: ast.AST, callee: str) -> list[ast.keyword]:
    """Every ``callee(...)`` call inside ``func``, as keyword dicts."""
    out = []
    for node in ast.walk(func):
        if not isinstance(node, ast.Call):
            continue
        name = ast.unparse(node.func)
        if name.split(".")[-1] == callee:
            out.extend(node.keywords)
    return out


class TestTheTwoLoopsAreDisjoint:
    def test_recorded_loop_filters_by_type(self):
        fn = _functions(SERVICE)["sync_komoot_routes"]
        recorded = [
            kw
            for kw in _call_keywords(fn, "get_tours")
            if kw.arg == "tour_type"
        ]
        assert recorded, (
            "get_tours is called with no tour_type filter, so the recorded "
            "loop also ingests every planned route"
        )
        value = ast.literal_eval(recorded[0].value)
        assert value == "tour_recorded", (
            f"expected tour_recorded, got {value!r}. Note that "
            "'recorded' and 'planned' both return HTTP 400 from the v007 API"
        )

    def test_planned_loop_still_filters(self):
        """The planned filter lives in the client, not at the call site.

        ``get_routes`` hardcodes ``type: tour_planned`` in its params and
        takes no ``tour_type`` argument, so asserting on the call site would
        have passed even with the filter deleted.
        """
        fn = _functions(CLIENT)["get_routes"]
        src = ast.unparse(fn)
        assert '"tour_planned"' in src or "'tour_planned'" in src, (
            "get_routes must keep filtering to tour_planned, or it becomes a "
            "second unfiltered path and the loops overlap again"
        )
        # And the planned loop must go through get_routes, not get_tours.
        planned = _call_keywords(_functions(SERVICE)["sync_komoot_routes"], "get_routes")
        assert planned, "the planned loop no longer calls get_routes"


class TestTheLabelComesFromThePayload:
    def test_komoot_type_is_not_derived_from_the_call_site(self):
        """Labelling by which loop ran is what wrote 30 wrong labels."""
        src = SERVICE.read_text(encoding="utf-8")
        assert '"planned" if is_planned_route else "recorded"' not in src, (
            "_komoot_type must come from tour_data['type']; the two loops were "
            "not disjoint, so the call site lied about 30 rows"
        )

    def test_payload_type_wins_when_present(self):
        fn = _functions(SERVICE)["_enrich_and_create_route"]
        src = ast.unparse(fn)
        # ast.unparse normalises string quotes, so match either form.
        assert "tour_data.get('type')" in src or 'tour_data.get("type")' in src, (
            "_komoot_type must be read from the payload"
        )
        assert "_komoot_type" in src


class TestTheDocumentedFilterValuesAreReal:
    """The docstring used to advertise two values that 400."""

    def test_docstring_no_longer_suggests_invalid_values(self):
        doc = ast.get_docstring(_functions(CLIENT)["get_tours"]) or ""
        for bad in ('"recorded"', '"planned"'):
            assert f"e.g. {bad}" not in doc, (
                f"{bad} is not a valid v007 tour_type; it returns HTTP 400"
            )
        assert "tour_recorded" in doc and "tour_planned" in doc, (
            "the docstring should name the two values that actually work"
        )
