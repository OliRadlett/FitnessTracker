"""Migration 089 adds ``routes.quarantined_at``.

A nullable timestamp, not a boolean: ``NULL`` means "never quarantined",
and the value is the audit of *when* the route was set aside. A boolean
could not distinguish "quarantined" from "quarantined and restored", and
re-running the sweep would overwrite the original date.

The migration must be inert. It adds a column and changes nothing else —
in particular it must NOT quarantine anything itself, because "which
routes are orphans" is a data judgement that has to be inspectable and
reversible before it is written.
"""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "089_add_route_quarantine.py"
)


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(f"mig_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_exists():
    assert MIGRATION_PATH.exists(), f"{MIGRATION_PATH.name} does not exist"


def test_revision_chain_is_linear():
    module = _load(MIGRATION_PATH)
    assert module.revision == "089"
    assert module.down_revision == "088"


def test_upgrade_adds_a_nullable_timestamp():
    source = MIGRATION_PATH.read_text(encoding="utf-8")
    upgrade = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "quarantined_at" in upgrade
    assert "add_column" in upgrade
    # Nullable: existing rows must default to "not quarantined".
    assert "nullable=True" in upgrade, (
        "quarantined_at must be nullable, or every existing route would be "
        "quarantined the moment the column is added"
    )
    assert "DateTime" in upgrade, "quarantined_at must be a timestamp, not a bool"


def test_downgrade_drops_the_column():
    source = MIGRATION_PATH.read_text(encoding="utf-8")
    downgrade = source.split("def downgrade()", 1)[1]
    assert "drop_column" in downgrade
    assert "quarantined_at" in downgrade


def test_migration_does_not_read_config():
    tree = ast.parse(MIGRATION_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("app."):
            raise AssertionError(
                f"{MIGRATION_PATH.name} imports {node.module!r}; a migration "
                "must not read application config"
            )


def test_migration_writes_no_data():
    """Adding the column must not quarantine anything by itself.

    The set of orphans is a data judgement; doing it inside the migration
    would make it invisible and irreversible at migration time. It belongs
    in an explicit, dry-run-first sweep.
    """
    source = MIGRATION_PATH.read_text(encoding="utf-8")
    upgrade = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    for forbidden in ("UPDATE", "DELETE", "INSERT"):
        assert forbidden not in upgrade.upper(), (
            f"upgrade() must not contain {forbidden}; quarantine is an explicit "
            "sweep, not part of the schema change"
        )
