"""Ingestion paths must consult the sport-type allowlist.

The allowlist itself is covered by ``test_sport_filter.py``. This file
covers the second half of the contract: that each provider's ingestion
path actually consults it, so a walk arriving from Strava, Wahoo or Whoop
does not create an Activity.

A pure-predicate test would pass even if every call site were missing,
which is the failure mode that matters here -- the predicate existing is
not the same as it being used.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.services.strava.sync import _map_strava_type

BACKEND = Path(__file__).resolve().parents[1]

# Every module that constructs or merges an Activity row. Each must
# reference the allowlist somewhere in its source.
INGESTION_MODULES = [
    "app/services/strava/sync.py",
    "app/services/strava/webhooks.py",
    "app/services/wahoo.py",
    "app/services/whoop.py",
    "app/api/activities.py",
]


@pytest.mark.parametrize("module_path", INGESTION_MODULES)
def test_ingestion_module_consults_the_allowlist(module_path: str) -> None:
    """Each ingestion path must reference is_allowed_sport.

    Static rather than behavioural: a behavioural test per provider needs
    a live DB, a mocked provider payload, and a sync harness, which is a
    lot of machinery to assert one call. The import plus a reference
    catches the real regression -- a new provider path added without the
    gate.
    """
    source = (BACKEND / module_path).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported = any(
        isinstance(node, ast.ImportFrom)
        and (node.module or "").endswith("sport_filter")
        and any(a.name == "is_allowed_sport" for a in node.names)
        for node in ast.walk(tree)
    )
    assert imported, (
        f"{module_path} does not import is_allowed_sport from sport_filter. "
        "Every path that creates or merges an Activity must gate on the "
        "allowlist, or blocked sports reappear on the next sync."
    )

    called = any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "is_allowed_sport"
        for node in ast.walk(tree)
    )
    assert called, f"{module_path} imports is_allowed_sport but never calls it"


class TestStravaTypeMappingStillResolves:
    """The type map must keep naming every sport, allowed or not.

    Filtering happens at the gate, not by deleting entries from the map.
    Removing "Walk" from ``_STRAVA_TYPE_MAP`` would make a walk map to
    "walk" -- still outside the allowlist, so still blocked, but it would
    lie to the merge/dedup logic, which compares sport types to decide
    whether two rows are the same activity.
    """

    def test_walk_maps_to_walking(self):
        assert _map_strava_type("Walk") == "walking"

    def test_hike_maps_to_hiking(self):
        assert _map_strava_type("Hike") == "hiking"

    def test_ride_maps_to_cycling(self):
        assert _map_strava_type("Ride") == "cycling"

    def test_weight_training_maps_to_strength(self):
        assert _map_strava_type("WeightTraining") == "strength"
