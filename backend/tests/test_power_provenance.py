"""Power provenance — classification, read contract, and the backfill's guards.

Strava's activity summary carries ``device_watts``: ``true`` when a meter or
trainer recorded the channel, ``false`` when Strava *estimated* the watts from
heart rate, speed and bodyweight. Nothing read it, so an estimated ride was
indistinguishable from a measured one and could carry a power-derived TSS and a
W/kg figure that read as measured.

The classification has one subtle rule worth pinning: a Strava run (or a ride
with no meter and no estimate) also reports ``device_watts: false``. Treating
the flag alone as evidence would label every activity without a power meter
``estimated``, which claims the provider guessed a number it never produced. So
"no power channel" must be *unknown*, not *estimated* — and unknown must be read
as trusted downstream, because withholding trust from unclassified watts would
silently drop real rides.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from app.schemas.activity import ActivityDetailRead, ActivityRead
from app.services.merge_service import _MERGE_FIELDS
from app.services.power_provenance import (
    POWER_ESTIMATED,
    POWER_MEASURED,
    from_strava_payload,
)

MIGRATIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
POWER_MIGRATION = MIGRATIONS / "111_add_activity_power_provenance.py"


class TestStravaPayload:
    def test_device_watts_true_is_measured(self):
        assert (
            from_strava_payload({"average_watts": 231.4, "device_watts": True})
            == POWER_MEASURED
        )

    def test_device_watts_false_with_power_is_estimated(self):
        assert (
            from_strava_payload({"average_watts": 187.0, "device_watts": False})
            == POWER_ESTIMATED
        )

    @pytest.mark.parametrize(
        "payload",
        [
            # A run, or a ride with no meter and no estimate: the flag is
            # present but there is no power channel to have an opinion about.
            {"device_watts": False},
            {"device_watts": True},
            # No flag at all — an older or partial payload.
            {"average_watts": 200.0},
            # Explicit nulls.
            {"average_watts": None, "device_watts": False},
            {},
        ],
    )
    def test_unanswerable_payloads_are_unknown_not_estimated(self, payload):
        assert from_strava_payload(payload) is None


class TestReadContract:
    def test_list_schema_exposes_provenance(self):
        assert "power_provenance" in ActivityRead.model_fields

    def test_detail_schema_inherits_it(self):
        assert "power_provenance" in ActivityDetailRead.model_fields

    def test_provenance_travels_with_power_through_a_merge(self):
        """Whichever provider's watts win, its provenance wins with them.

        Adjacency is the point: a merge that copies ``average_power`` without
        its provenance leaves the row describing the other provider's power.
        """
        assert "power_provenance" in _MERGE_FIELDS
        assert (
            _MERGE_FIELDS.index("power_provenance")
            == _MERGE_FIELDS.index("average_power") + 1
        )


class TestBackfillMigration:
    """The backfill runs once, against production, with no dry run.

    Asserted against the migration's own ``_BACKFILL`` string rather than a
    regex over the file: the docstring *describes* the rejected ``::boolean``
    cast, so matching file text would fail on prose.
    """

    def test_chains_onto_the_head_it_was_written_against(self):
        assert _MIGRATION.revision == "111"
        assert _MIGRATION.down_revision == "110"

    def test_does_not_label_powerless_activities(self):
        """Strava reports ``device_watts: false`` for runs too.

        Without this guard every run in the database becomes "estimated", which
        asserts the provider guessed a power number it never sent.
        """
        assert "average_power IS NOT NULL" in _MIGRATION._BACKFILL

    def test_compares_the_flag_as_json_text(self):
        """A ``::boolean`` cast raises on unexpected text, and a raising
        migration reverts itself under transactional DDL (pitfall 22)."""
        assert "::boolean" not in _MIGRATION._BACKFILL
        assert "IN ('true', 'false')" in _MIGRATION._BACKFILL

    def test_backfills_only_strava_rows(self):
        """Whoop/Wahoo/manual rows have no ``device_watts`` key; the WHERE
        clause keeps them out of the update rather than relying on JSON nulls."""
        assert "source = 'strava'" in _MIGRATION._BACKFILL


def _load_migration():
    """Import the migration by path — its filename starts with a digit."""
    spec = importlib.util.spec_from_file_location("migration_107", POWER_MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_MIGRATION = _load_migration()
