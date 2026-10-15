"""Migration 099 adds ``training_plans.strength_progression``.

The S1 progression rules (mode / start / weekly deltas / deload / training max)
had nowhere to live: ``StrengthWeekTemplate`` was generation-time only, so the
ramp was written into days once and then inert. This is the one migration S1
carries, and it is deliberately inert — a nullable column, no backfill, no data
rewrite (NULL means "no rules", i.e. exactly the previous behaviour).

No SQLite upgrade/downgrade round-trip here, unlike 098: the column is
``postgresql.JSONB`` and SQLite's type compiler cannot render that, so the
round-trip would fail for a reason unrelated to the change. The DDL is asserted
statically instead, plus the model-agreement check (pitfall 24) that matters
more: a model column the database does not have fails at runtime, not at
migration time.
"""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "099_add_training_plan_strength_progression.py"
)

VERSIONS_DIR = MIGRATION_PATH.parent


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(f"mig_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _upgrade_source() -> str:
    src = MIGRATION_PATH.read_text(encoding="utf-8")
    return src.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]


def test_migration_exists():
    assert MIGRATION_PATH.exists(), f"{MIGRATION_PATH.name} does not exist"


def test_revision_chain_is_linear():
    module = _load(MIGRATION_PATH)
    assert module.revision == "099"
    assert module.down_revision == "098"


def test_revision_number_is_unique_across_the_chain():
    """A duplicate revision number breaks *every* alembic command (pitfall 34).

    ``get_heads()`` raises ``KeyError`` when two files claim one number, so
    even ``alembic current`` fails and the environment reads as corrupt. A
    branch can ship a number that ``main`` then also ships, so this asserts the
    number is claimed exactly once in the tree as it stands.
    """
    claimed: dict[str, list[str]] = {}
    for path in sorted(VERSIONS_DIR.glob("*.py")):
        module = _load(path)
        revision = getattr(module, "revision", None)
        if revision:
            claimed.setdefault(revision, []).append(path.name)
    assert claimed.get("099") == [MIGRATION_PATH.name], (
        f"revision '099' claimed by {claimed.get('099')}"
    )


def test_adds_a_nullable_jsonb_column():
    up = _upgrade_source()
    assert "strength_progression" in up
    assert "training_plans" in up
    assert "nullable=True" in up, "existing plans must start as 'no rules'"
    assert "JSONB" in up


def test_uses_the_dialect_import_not_sa_jsonb():
    """``sa.JSONB()`` does not exist (pitfall 22) — and its AttributeError
    reverts the whole migration under transactional DDL.

    Checked through the AST rather than the text: the docstring *names* the
    trap it avoids, and a substring search would flag the explanation.
    """
    src = MIGRATION_PATH.read_text(encoding="utf-8")
    assert "from sqlalchemy.dialects import postgresql" in src
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Attribute)
            and node.attr == "JSONB"
            and isinstance(node.value, ast.Name)
            and node.value.id == "sa"
        ):
            raise AssertionError(
                "sa.JSONB does not exist; use postgresql.JSONB() (pitfall 22)"
            )


def test_downgrade_drops_it():
    down = MIGRATION_PATH.read_text(encoding="utf-8").split("def downgrade()", 1)[1]
    assert "drop_column" in down and "strength_progression" in down


def test_writes_no_data():
    up = _upgrade_source()
    for bad in ("UPDATE", "DELETE", "INSERT"):
        assert bad not in up.upper(), "099 is inert: schema only, no backfill"


def test_does_not_read_config():
    tree = ast.parse(MIGRATION_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("app."):
            raise AssertionError(
                f"{MIGRATION_PATH.name} imports {node.module!r}; a migration "
                "must not read application config"
            )


def test_model_declares_the_column():
    """Model and migration must agree, or the ORM queries a missing column."""
    from app.models.training_plan import TrainingPlan

    column = TrainingPlan.__table__.columns["strength_progression"]
    assert column.nullable is True
