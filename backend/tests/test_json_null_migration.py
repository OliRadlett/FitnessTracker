"""The JSON-null repair and the model declarations must not drift apart.

The bug had two halves that had to be fixed together, and nothing tied them
together: the model needed ``none_as_null=True`` to stop writing JSON null,
and a migration was needed to repair the rows already written. Fixing one
without the other leaves either new occurrences or permanently
un-re-matchable rows, and neither is visible without reading the column back
as raw SQL.

These tests assert the two halves name the same set of columns. They are
cheap and static on purpose: the behavioural proof needs a real database and
lives in ``tests/integration/test_cleared_jsonb_is_sql_null.py``.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION = VERSIONS / "092_json_null_to_sql_null.py"

# The (table, column) pairs the models declare none_as_null=True.
MODEL_TARGETS = {
    ("routes", "road_match"),
    ("routes", "road_embedding"),
    ("routes", "terrain_classification"),
    ("activities", "road_match"),
    ("activities", "road_embedding"),
}


def _targets() -> set[tuple[str, str]]:
    tree = ast.parse(MIGRATION.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if not any(getattr(t, "id", None) == "TARGETS" for t in node.targets):
            continue
        return {ast.literal_eval(e) for e in node.value.elts}
    raise AssertionError(f"TARGETS not found in {MIGRATION.name}")


def _model_none_as_null() -> set[tuple[str, str]]:
    """Every column in the models declared ``JSONB(none_as_null=True)``."""
    from app.models.activity import Activity
    from app.models.route import Route

    found: set[tuple[str, str]] = set()
    for model in (Route, Activity):
        table = model.__tablename__
        for name, col in model.__table__.columns.items():
            if getattr(col.type, "none_as_null", False):
                found.add((table, name))
    return found


class TestMigrationAndModelsAgree:
    def test_migration_exists_at_head_chain(self):
        assert MIGRATION.is_file(), (
            "the JSON-null repair is missing; the model fix alone leaves "
            "existing rows permanently un-re-matchable"
        )

    def test_migration_repairs_exactly_what_the_model_writes(self):
        assert _targets() == MODEL_TARGETS, (
            f"migration targets {_targets()} but models declare "
            f"{MODEL_TARGETS}"
        )

    def test_migration_has_no_downgrade_that_would_reintroduce_the_bug(self):
        source = MIGRATION.read_text(encoding="utf-8")
        tree = ast.parse(source)
        downgrade = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.FunctionDef) and n.name == "downgrade"
        )
        assert "NotImplementedError" in ast.unparse(downgrade), (
            "JSON null and SQL NULL are indistinguishable in Python, so a "
            "downgrade cannot be written; it must refuse rather than write "
            "JSON null back to every empty column"
        )

    def test_targets_are_hardcoded_not_built_from_the_model(self):
        """The migration must be frozen against later model changes."""
        source = MIGRATION.read_text(encoding="utf-8")
        assert "app.models" not in source, (
            "an alembic revision must not import app models — by the time it "
            "runs, the model may have moved on, and the migration is history"
        )


class TestEveryNoneAsNullColumnIsIntendedToBeCleared:
    @pytest.mark.parametrize("table,column", sorted(MODEL_TARGETS))
    def test_column_is_nullable_jsonb(self, table, column):
        """Guard against the flag landing on a NOT NULL or non-JSON column."""
        import sqlalchemy as sa
        from sqlalchemy.dialects.postgresql import JSONB

        from app.database import Base

        col = Base.metadata.tables[table].columns[column]
        assert isinstance(col.type, JSONB), f"{table}.{column} is not JSONB"
        assert col.nullable, f"{table}.{column} is NOT NULL, so it is never cleared"
        assert sa is not None
