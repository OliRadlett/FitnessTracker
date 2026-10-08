"""Migration 098 persists personalized-VO2max fit diagnostics.

Only the number (``cycling_profiles.personalized_vo2max``) persisted, so a
stamped value with no provenance was indistinguishable from a good one.
098 adds method / R² / data-points / HR-anchor / maximal-watts columns; the
scheduler fills them from the worker result.

Follows the 090 precedent: the migration exposes ``_ADDITIONS`` so this
test cross-checks it against the model (pitfall 24), plus a real
upgrade→downgrade DDL round-trip on SQLite (add/drop nullable columns need
no Postgres, so this runs host-side as well as in CI).
"""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "098_add_vo2max_diagnostics.py"
)

EXPECTED_COLUMNS = {
    "personalized_vo2max_method",
    "personalized_vo2max_r_squared",
    "personalized_vo2max_data_points",
    "personalized_vo2max_hr_threshold",
    "personalized_vo2max_maximal_watts",
}


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(f"mig_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_exists():
    assert MIGRATION_PATH.exists(), f"{MIGRATION_PATH.name} does not exist"


def test_revision_chain_is_linear():
    module = _load(MIGRATION_PATH)
    assert module.revision == "098"
    assert module.down_revision == "097"


def test_additions_cover_the_model_columns():
    """The migration must add every diagnostics column the model declares."""
    from app.models.cycling import CyclingProfile

    module = _load(MIGRATION_PATH)
    added = {name for name, _ in module._ADDITIONS}
    assert EXPECTED_COLUMNS <= added
    model_columns = set(CyclingProfile.__table__.columns.keys())
    assert EXPECTED_COLUMNS <= model_columns
    assert {name for name, _ in module._ADDITIONS} == EXPECTED_COLUMNS


def test_upgrade_downgrade_round_trip():
    """Real DDL round-trip: upgrade adds the five columns, downgrade drops
    them again. Runs on SQLite — nullable add/drop needs no Postgres."""
    from sqlalchemy import create_engine, inspect

    module = _load(MIGRATION_PATH)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "CREATE TABLE cycling_profiles (id TEXT PRIMARY KEY, "
                "personalized_vo2max FLOAT)"
            )
        with engine.begin() as conn:
            ctx = MigrationContext.configure(conn)
            module.op = Operations(ctx)
            module.upgrade()
        cols = inspect(engine).get_columns("cycling_profiles")
        names = {c["name"] for c in cols}
        assert EXPECTED_COLUMNS <= names, (
            f"missing after upgrade: {sorted(EXPECTED_COLUMNS - names)}"
        )
        with engine.begin() as conn:
            ctx = MigrationContext.configure(conn)
            module.op = Operations(ctx)
            module.downgrade()
        names = {
            c["name"] for c in inspect(engine).get_columns("cycling_profiles")
        }
        assert not (EXPECTED_COLUMNS & names), (
            f"left after downgrade: {sorted(EXPECTED_COLUMNS & names)}"
        )
    finally:
        engine.dispose()


def test_migration_does_not_read_config():
    tree = ast.parse(MIGRATION_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("app."):
            raise AssertionError(
                f"{MIGRATION_PATH.name} imports {node.module!r}; a migration "
                "must not read application config"
            )
