"""Migration 076 must tolerate however the legacy constraint was named.

``005_add_routes.py`` created ``route_sources`` with a bare
``UNIQUE (provider, provider_route_id)`` inside ``CREATE TABLE``, so on any
migration-built database PostgreSQL auto-named it
``route_sources_provider_provider_route_id_key``. The original 076 dropped a
hard-coded ``uq_route_source_provider`` — a name only ``create_all()``
databases ever carried — so ``alembic upgrade head`` died on a fresh database
with ``UndefinedObjectError``. Production escaped only because its schema came
from ``create_all()``.

The decision logic is a pure function so the regression is testable without a
live database; the constraint inventory it consumes is read from
``pg_constraint`` by the migration itself.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions"
    / "076_scope_route_sources_to_user.py"
)


def _load_migration():
    return _load(MIGRATION_PATH)


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(f"mig_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mig_076 = _load_migration()

_LEGACY_COLS = ("provider", "provider_route_id")
# What PostgreSQL itself names the constraint declared in 005.
AUTO_NAME = "route_sources_provider_provider_route_id_key"
# What SQLAlchemy's create_all named it (the name 076 originally assumed).
DECLARED_NAME = "uq_route_source_provider"


class TestLegacyUniqueConstraintDiscovery:
    def test_finds_auto_generated_name(self):
        """The migration-built case — this is the one that used to crash."""
        found = mig_076._legacy_global_unique_names({AUTO_NAME: _LEGACY_COLS})
        assert found == [AUTO_NAME]

    def test_finds_declared_name(self):
        assert mig_076._legacy_global_unique_names({DECLARED_NAME: _LEGACY_COLS}) == [
            DECLARED_NAME
        ]

    def test_ignores_user_scoped_constraint(self):
        """Already-migrated databases must not drop the constraint they want."""
        constraints = {
            "uq_route_source_provider_user": (
                "provider",
                "provider_route_id",
                "user_id",
            )
        }
        assert mig_076._legacy_global_unique_names(constraints) == []

    def test_ignores_unrelated_unique_constraints(self):
        constraints = {"route_sources_pkey": ("id",)}
        assert mig_076._legacy_global_unique_names(constraints) == []

    def test_no_hardcoded_constraint_name_in_upgrade(self):
        """Guard the original bug: upgrade() must not name a constraint."""
        source = MIGRATION_PATH.read_text(encoding="utf-8")
        upgrade_body = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
        assert DECLARED_NAME not in upgrade_body

    def test_chain_is_linear_and_has_a_single_head(self):
        """The whole 001..head chain must be unbroken with exactly one head.

        Guards the failure mode behind the duplicate-``078`` collision: two
        revisions claiming the same id, or a ``down_revision`` pointing at a
        revision that no file declares, silently forks or strands the chain.
        """
        versions_dir = Path(__file__).resolve().parents[1] / "alembic" / "versions"
        revisions: dict[str, str] = {}
        for path in versions_dir.glob("*.py"):
            module = _load(path)
            revision = getattr(module, "revision", None)
            if revision is None:  # helper module, not a migration
                continue
            assert revision not in revisions, (
                f"duplicate revision {revision!r}: "
                f"{revisions[revision]} and {path.name}"
            )
            revisions[revision] = path.name

        assert "076" in revisions
        # Every down_revision must resolve.
        for path in versions_dir.glob("*.py"):
            module = _load(path)
            down = getattr(module, "down_revision", None)
            if getattr(module, "revision", None) is None or down is None:
                continue
            assert down in revisions, (
                f"{path.name}: down_revision {down!r} is not a declared revision"
            )
        # Exactly one head: one revision nothing else points at.
        pointed_at = {
            getattr(_load(p), "down_revision", None) for p in versions_dir.glob("*.py")
        }
        heads = set(revisions) - pointed_at
        assert len(heads) == 1, f"expected a single alembic head, got {sorted(heads)}"


@pytest.mark.parametrize("legacy_name", [AUTO_NAME, DECLARED_NAME])
def test_either_shape_is_dropped_exactly_once(legacy_name):
    """A mixed inventory (both names, e.g. after a partial run) drops both."""
    constraints = {
        legacy_name: _LEGACY_COLS,
        "uq_route_source_provider_user": (
            "provider",
            "provider_route_id",
            "user_id",
        ),
    }
    assert mig_076._legacy_global_unique_names(constraints) == [legacy_name]
