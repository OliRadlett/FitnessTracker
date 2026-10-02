"""A ride must not become a route.

``sync_strava_routes`` section 2 turned every Strava cycling activity with a
polyline into a ``Route``, stored as ``provider_route_id =
f"activity_{id}"``. It was added in #189 and ran unguarded on every sync.

It contradicts an agreed decision. ``plans/ride-course-split.md`` §2 records
that ``Route`` means *Course*, and lists what Route is **not**: "a recorded
ride cluster". Rides are supposed to link *to* courses many-to-one.

The failure is not that ride-shaped routes exist, it is what
``create_or_merge_route`` then does with them. Its geometric dedupe absorbs
any candidate scoring >=0.82 against an existing route, and rides on familiar
roads score high. Production ended up with five routes holding 4-7 distinct
rides each; the worst held seven rides across four months and seven different
distances, alongside a real Strava course id.

``route_auto_merge_enabled`` does **not** gate this. That flag guards the
similarity *task*; this merge happens during sync, inside
``create_or_merge_route``. The two are independent, which is why adding the
flag earlier did nothing for this path.
"""

from __future__ import annotations

import ast
from pathlib import Path

SYNC = Path(__file__).resolve().parents[1] / "app" / "services" / "strava" / "sync.py"
CONFIG = Path(__file__).resolve().parents[1] / "app" / "config.py"

_FN = (ast.FunctionDef, ast.AsyncFunctionDef)


def _fn(path: Path, name: str):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return next(n for n in ast.walk(tree) if isinstance(n, _FN) and n.name == name)


def _fn_src(path: Path, name: str) -> str:
    return ast.unparse(_fn(path, name))


class TestThePathIsGated:
    def test_section_two_is_gated_on_the_flag(self):
        src = _fn_src(SYNC, "sync_strava_routes")
        assert "strava_activity_routes_enabled" in src, (
            "activity-derived route creation must be gated; while unguarded it "
            "absorbed 27 distinct rides into 5 routes"
        )

    def test_the_gate_returns_before_creating_anything(self):
        """The flag must short-circuit, not merely be consulted.

        A flag that is read but does not return early is the same class of
        defect as ``route_auto_merge_enabled`` existing only in prose.
        """
        src = _fn_src(SYNC, "sync_strava_routes")
        guard = src.index("strava_activity_routes_enabled")
        ret = src.index("return", guard)
        create = src.index("create_or_merge_route", ret)
        assert guard < ret < create, (
            "the disabled branch must return before any route is created"
        )

    def test_the_flag_defaults_to_off(self):
        from app.config import get_settings

        assert get_settings().strava_activity_routes_enabled is False, (
            "rides must not become routes by default; this is the entire "
            "reason the flag exists"
        )

    def test_the_rationale_is_recorded_next_to_the_default(self):
        source = CONFIG.read_text(encoding="utf-8")
        i = source.index("strava_activity_routes_enabled")
        window = source[max(0, i - 1400) : i]
        assert "ride-course-split" in window or "course" in window.lower(), (
            "a default that only lives in code reverts the first time someone "
            "reads the setting instead of the plan"
        )


class TestTheUnderlyingFalsePositiveIsBounded:
    """The flag is a policy decision. This is the mechanism it turns off."""

    def test_auto_merge_flag_does_not_gate_this_path(self):
        """Documents why the earlier fix did not cover this.

        If someone later wires ``route_auto_merge_enabled`` in here as the
        "fix", it will read as covered while the path still runs.
        """
        src = _fn_src(SYNC, "sync_strava_routes")
        assert "route_auto_merge_enabled" not in src, (
            "sync-time dedupe is a separate mechanism from the similarity "
            "task's auto-merge; conflating them hides which one is live"
        )

    def test_dedupe_still_exists_for_genuine_route_objects(self):
        """The gate must not have removed dedupe wholesale.

        Two genuine Strava *routes* that are the same road should still
        converge. Only ride-derived routes are in question.
        """
        src = _fn_src(SYNC, "sync_strava_routes")
        routes_api = src.index("get_athlete_routes")
        assert "create_or_merge_route" in src[routes_api:], (
            "the Routes API path must still create/merge routes"
        )
