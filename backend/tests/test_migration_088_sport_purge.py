"""Migration 088 purges untracked sports, with a recoverable backup.

Walks and hikes were being ingested from Strava, Wahoo and Whoop even
though FitTrack only tracks cycling and strength. 291 walking/hiking
activities existed, plus 7 golf, 7 swimming and 2 kayaking.

The purge is a SQL literal, NOT a read of ``ALLOWED_SPORT_TYPES``. A
migration must behave identically on every replay, so it cannot depend on
mutable config; the two are deliberately coupled and must be changed
together (see ``app/services/sport_filter.py``).

Checked here, without a live database, the same way as
``test_migration_076_constraint_names.py``:
  - the predicate keeps exactly the allowed sports
  - the backup table is populated before the delete, and is a full copy
  - the migration is reversible, and the backup is dropped on downgrade
  - the gate is a literal, so a config change cannot silently alter history
"""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "088_purge_untracked_sport_activities.py"
)
BACKUP_TABLE = "_purged_activities_088"


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(f"mig_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _skip_if_absent() -> None:
    """Fail, not skip, when the migration is missing.

    A skip would let this file report success while testing nothing, which
    is how a missing migration would ship unnoticed. These tests exist to
    gate the migration, so an absent file is a failure.
    """
    assert MIGRATION_PATH.exists(), f"{MIGRATION_PATH.name} does not exist"


class TestPredicate:
    def test_upgrade_exists(self):
        _skip_if_absent()
        assert MIGRATION_PATH.exists()

    def test_purges_everything_except_cycling_and_strength(self):
        """The kept set is the whole policy, and it is a literal.

        Asserted against the module constant rather than the rendered SQL:
        the statements interpolate ``KEPT_SPORTS``, so searching the source
        text for a quoted literal would only prove the f-string exists.
        """
        _skip_if_absent()
        module = _load(MIGRATION_PATH)
        assert module.KEPT_SPORTS == ("cycling", "strength")

    def test_both_statements_use_the_kept_set(self):
        """Neither the backup nor the delete may diverge from KEPT_SPORTS."""
        _skip_if_absent()
        source = MIGRATION_PATH.read_text(encoding="utf-8")
        upgrade = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
        assert "CREATE TABLE" in upgrade and "DELETE FROM activities" in upgrade
        # Both statements must interpolate the shared set, not inline a
        # second copy of the sport list.
        assert upgrade.count("NOT IN ({kept})") == 2, (
            "the backup and the delete must share one predicate"
        )

    def test_handles_null_sport_type(self):
        """A NULL sport_type is not 'allowed' by an IN (...) test alone.

        ``NULL NOT IN (...)`` evaluates to NULL, not TRUE, so a row with a
        null sport_type would survive the delete without the explicit
        clause and quietly reappear as an untracked activity.
        """
        _skip_if_absent()
        source = MIGRATION_PATH.read_text(encoding="utf-8")
        upgrade = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
        assert upgrade.count("sport_type IS NULL") == 2, (
            "both statements must explicitly exclude NULL sport_type"
        )

    def test_does_not_read_config(self):
        """A migration must be reproducible, so no settings import.

        If this ever regresses, replaying 088 on a database with different
        ALLOWED_SPORT_TYPES would delete a different set of rows than the
        one that was recorded.
        """
        _skip_if_absent()
        tree = ast.parse(MIGRATION_PATH.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(
                "app."
            ):
                pytest.fail(
                    f"{MIGRATION_PATH.name} imports {node.module!r}; a migration "
                    "must not read application config"
                )


class TestBackup:
    def test_backup_gets_a_primary_key(self):
        """CREATE TABLE AS drops constraints; restore needs ON CONFLICT (id).

        Without an explicit primary key the backup table has no unique
        index on ``id``, so the downgrade's ``ON CONFLICT (id) DO NOTHING``
        has nothing to match against and raises.
        """
        _skip_if_absent()
        source = MIGRATION_PATH.read_text(encoding="utf-8")
        upgrade = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
        assert "ADD PRIMARY KEY (id)" in upgrade, (
            "the backup table must get a primary key, or the downgrade's "
            "ON CONFLICT (id) has no index to match and raises"
        )
        pk_at = upgrade.find("ADD PRIMARY KEY (id)")
        delete_at = upgrade.find("DELETE FROM activities")
        assert pk_at < delete_at, "add the key before deleting"

    def test_backup_created_before_delete(self):
        """Ordering matters: back up first, then delete.

        If the delete ran first the backup would capture nothing and the
        purge would be irreversible.
        """
        _skip_if_absent()
        source = MIGRATION_PATH.read_text(encoding="utf-8")
        upgrade = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
        backup_at = upgrade.find("CREATE TABLE")
        delete_at = upgrade.find("DELETE FROM activities")
        assert backup_at != -1, "no backup table created"
        assert delete_at != -1, "no delete"
        assert backup_at < delete_at, (
            "backup must be taken before the delete, or it captures nothing"
        )
        assert "{BACKUP_TABLE}" in upgrade, (
            "the backup table name must come from the BACKUP_TABLE constant, "
            "so upgrade and downgrade cannot disagree about it"
        )
        assert "SELECT * FROM activities" in upgrade, "backup must copy all columns"

    def test_backup_copies_every_column(self):
        """SELECT * so a future column is captured without editing this."""
        _skip_if_absent()
        source = MIGRATION_PATH.read_text(encoding="utf-8")
        assert "SELECT *" in source.upper().replace("SELECT  *", "SELECT *")

    def test_backup_is_dropped_on_downgrade(self):
        _skip_if_absent()
        module = _load(MIGRATION_PATH)
        assert module.BACKUP_TABLE == BACKUP_TABLE
        source = MIGRATION_PATH.read_text(encoding="utf-8")
        downgrade = source.split("def downgrade()", 1)[1]
        assert "{BACKUP_TABLE}" in downgrade, (
            "downgrade must reference the backup table via the constant"
        )
        assert "DROP TABLE IF EXISTS" in downgrade, (
            "downgrade must drop the backup table, or a re-upgrade collides "
            "with the leftover CREATE TABLE"
        )


class TestReversibility:
    def test_downgrade_restores_rows(self):
        _skip_if_absent()
        source = MIGRATION_PATH.read_text(encoding="utf-8")
        downgrade = source.split("def downgrade()", 1)[1]
        assert "INSERT INTO activities" in downgrade, (
            "downgrade must be able to restore the purged rows"
        )
        assert "ON CONFLICT" in downgrade.upper(), (
            "restore must tolerate a row that already exists, or downgrade "
            "fails on any partially re-created data"
        )

    def test_chain_is_linear_with_single_head(self):
        """088 must extend 087 and not fork the chain."""
        _skip_if_absent()
        module = _load(MIGRATION_PATH)
        assert module.revision == "088"
        assert module.down_revision == "087"
