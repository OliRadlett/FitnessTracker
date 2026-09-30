"""Migration 090 reconciles ``lift_video_analyses`` with the model.

Production's table predates the current column set, so every model query
raised ``UndefinedColumnError`` and aborted the enclosing transaction —
taking the deficiency dashboard's form-quality section with it. The cause
is that the table was built by ``create_all()`` rather than by migration
053, so alembic stamped 053 without applying it (053's unique index is
absent from production, which is the tell).

The fix is forward-only and idempotent: add what the model declares, leave
alone what it does not. The legacy ``sample_count`` / ``trend_data``
columns are **not** dropped — they hold data on a populated database and
``trend_data`` has no one-to-one counterpart among the three ``*_trend``
columns, so it cannot be migrated.
"""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "090_reconcile_lift_video_analyses.py"
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
    assert module.revision == "090"
    assert module.down_revision == "089"


def test_adds_every_column_the_model_declares():
    """The whole point: schema and model must agree afterwards."""
    module = _load(MIGRATION_PATH)
    added = {name for name, *_ in module._ADDITIONS} | set(module._MISSING)
    assert {
        "video_count",
        "form_trend",
        "velocity_trend",
        "consistency_trend",
        "analyzed_at",
        "avg_velocity",
        "avg_consistency",
        "avg_rpe_accuracy",
    } <= added


def test_matches_the_model_definition():
    """Cross-check against the model, so the two cannot drift again.

    The bug existed precisely because the model and the database disagreed
    and nothing compared them. This asserts the migration covers every
    column the model declares that a stale table could plausibly lack.
    """
    from app.models.lift_video_analysis import LiftVideoAnalysis

    model_columns = set(LiftVideoAnalysis.__table__.columns.keys())
    module = _load(MIGRATION_PATH)
    added = {name for name, *_ in module._ADDITIONS} | set(module._MISSING)

    # Columns that have existed since 053 and so are never missing.
    baseline = {"id", "user_id", "exercise_name", "avg_form_score",
                "created_at", "updated_at"}
    expected = model_columns - baseline
    assert expected <= added, (
        f"migration does not cover {sorted(expected - added)} declared by the model"
    )


def test_never_drops_the_legacy_columns():
    """``sample_count`` / ``trend_data`` may hold data on another database.

    ``trend_data`` has no one-to-one counterpart among the three
    ``*_trend`` columns, so it cannot be migrated — dropping it would
    destroy data wherever the table is populated.
    """
    source = MIGRATION_PATH.read_text(encoding="utf-8")
    upgrade = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    for legacy in ("sample_count", "trend_data"):
        assert legacy not in upgrade, (
            f"upgrade() must not drop {legacy}; it may hold data"
        )
    assert "DROP COLUMN" not in upgrade.upper()


def test_restores_053s_unique_index():
    """The tell that the table came from create_all(), not from 053.

    Without this the aggregate task's upsert has no uniqueness guarantee
    to rely on.
    """
    module = _load(MIGRATION_PATH)
    assert module._UNIQUE_INDEX == "ix_lift_video_analyses_user_exercise"
    source = MIGRATION_PATH.read_text(encoding="utf-8")
    upgrade = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "create_index" in upgrade
    assert "unique=True" in upgrade


def test_refuses_to_create_the_index_over_duplicates():
    """Fails loudly rather than silently dropping a row.

    A unique index over duplicate pairs would otherwise either error with an
    opaque constraint violation or, worse, be created non-unique and hide
    the problem.
    """
    source = MIGRATION_PATH.read_text(encoding="utf-8")
    upgrade = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "HAVING count(*) > 1" in upgrade
    assert "raise RuntimeError" in upgrade


def test_migration_does_not_read_config():
    tree = ast.parse(MIGRATION_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("app."):
            raise AssertionError(
                f"{MIGRATION_PATH.name} imports {node.module!r}; a migration "
                "must not read application config"
            )
