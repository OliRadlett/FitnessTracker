"""Migration 091 adds ``routes.dismissed_at``.

The third state in orphan review. ``quarantined_at`` says "excluded from
matching"; it does not say "the user has looked at this". Without a
separate stamp a dismissed route is indistinguishable from one never
reviewed, so the review queue never empties.

Inert like 089: adds the column, stamps nothing.
"""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic" / "versions" / "091_add_route_dismissed_at.py"
)


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(f"mig_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_exists():
    assert MIGRATION_PATH.exists()


def test_revision_chain_is_linear():
    m = _load(MIGRATION_PATH)
    assert m.revision == "091"
    assert m.down_revision == "090"


def test_adds_a_nullable_timestamp():
    src = MIGRATION_PATH.read_text(encoding="utf-8")
    up = src.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "dismissed_at" in up
    assert "nullable=True" in up, (
        "nullable so existing quarantined routes start as 'not yet reviewed'"
    )
    assert "DateTime" in up


def test_downgrade_drops_it():
    src = MIGRATION_PATH.read_text(encoding="utf-8")
    down = src.split("def downgrade()", 1)[1]
    assert "drop_column" in down and "dismissed_at" in down


def test_writes_no_data():
    """Stamping is an explicit user action, never part of a schema change."""
    src = MIGRATION_PATH.read_text(encoding="utf-8")
    up = src.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    for bad in ("UPDATE", "DELETE", "INSERT"):
        assert bad not in up.upper()


def test_does_not_read_config():
    tree = ast.parse(MIGRATION_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("app."):
            raise AssertionError("a migration must not read application config")


def test_model_declares_the_column():
    """The model and the migration must agree, or the ORM queries a column
    the database does not have — the exact failure migration 090 fixed."""
    from app.models.route import Route

    assert "dismissed_at" in Route.__table__.columns
