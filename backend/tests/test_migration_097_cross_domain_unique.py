"""Migration 097 deduplicates cross_domain_insights and constrains one row per type.

RMI-08: the weekly scheduler blind-inserted a new ``CrossDomainInsight`` row per
``insight_type`` every run, so ``sleep_performance`` / ``cross_sport`` (and,
under Option A, ``race_retrospective``) accumulated without bound. The only
create site was ``scheduler.py:analyze_cross_domain_weekly``; readers masked the
growth except in the GDPR export.

This migration (1) deletes duplicate ``(user_id, insight_type)`` rows, keeping
the newest by ``(created_at DESC, id DESC)``, then (2) replaces migration 059's
non-unique index with a UNIQUE constraint that is the scheduler upsert's ON
CONFLICT target. The ordering — dedup *before* the constraint — is load-bearing:
a unique index cannot be built over duplicate pairs.

Like 090/091 it is a static, source-text check: no database needed, runs in
milliseconds, and still covers a migration that may already be applied
everywhere (an upgrade round-trip cannot assert on migrations already stamped).
"""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "097_deduplicate_cross_domain_insights.py"
)


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(f"mig_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_exists():
    assert MIGRATION_PATH.exists(), f"{MIGRATION_PATH.name} does not exist"


def test_revision_chain_is_linear():
    m = _load(MIGRATION_PATH)
    assert m.revision == "097"
    assert m.down_revision == "096"


def test_dedups_before_adding_the_constraint():
    """A unique index cannot be built over duplicate pairs.

    The cleanup DELETE must precede the constraint creation; otherwise the
    upgrade crashes with a unique-violation and (transactional DDL) rolls the
    whole migration back, leaving prod at 096 with the constraint unwritten.
    """
    src = MIGRATION_PATH.read_text(encoding="utf-8")
    up = src.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    delete_at = up.find("DELETE FROM cross_domain_insights")
    constraint_at = up.find("create_unique_constraint")
    assert delete_at != -1, "upgrade must delete duplicates before constraining"
    assert constraint_at != -1, "upgrade must add the unique constraint"
    assert delete_at < constraint_at, (
        "dedup DELETE must come before create_unique_constraint; a unique "
        "index over duplicate pairs raises and rolls back the transaction"
    )


def test_keeps_newest_per_user_and_type():
    """Retention is the newest by (created_at DESC, id DESC) — no silent
    random pick — so the migration is a defensible data transform, not luck."""
    src = MIGRATION_PATH.read_text(encoding="utf-8")
    up = src.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "PARTITION BY user_id, insight_type" in up
    assert "ORDER BY created_at DESC, id DESC" in up


def test_replaces_the_non_unique_index_with_a_unique_constraint():
    """059 built a *non-unique* lookup index; 097 must retire it and add the
    constraint whose implicit index serves the same lookups."""
    src = MIGRATION_PATH.read_text(encoding="utf-8")
    up = src.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "drop_index" in up and "ix_cross_domain_insights_user_type" in up
    assert "create_unique_constraint" in up
    assert "uq_cross_domain_insight_user_type" in up


def test_constraint_covers_all_three_types():
    """Option A (captain): one row per (user_id, insight_type) for ALL types —
    not a partial index that spares race_retrospective. Asserted on the source
    so the migration cannot drift back to per-event retention."""
    src = MIGRATION_PATH.read_text(encoding="utf-8")
    up = src.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    # A full (unconditional) UNIQUE CONSTRAINT, not a partial index that would
    # need a WHERE predicate and would spare race_retrospective.
    assert "create_unique_constraint" in up
    assert "postgresql_where" not in up, (
        "a partial 'WHERE insight_type != ...' index would let race_retrospective "
        "keep multiple rows; the constraint must be unconditional"
    )
    # The key is exactly (user_id, insight_type) — no third column such as
    # event_id (which lives inside results JSONB and is not a uniqueness key).
    assert "user_id" in up and "insight_type" in up
    assert "event_id" not in up


def test_downgrade_reverses():
    src = MIGRATION_PATH.read_text(encoding="utf-8")
    down = src.split("def downgrade()", 1)[1]
    assert "drop_constraint" in down and "uq_cross_domain_insight_user_type" in down
    assert "create_index" in down and "ix_cross_domain_insights_user_type" in down


def test_does_not_read_config():
    """A migration must not import application config — by the time it runs the
    model may have moved on, and the migration is history (pitfall 24)."""
    tree = ast.parse(MIGRATION_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("app."):
            raise AssertionError(
                f"{MIGRATION_PATH.name} imports {node.module!r}; a migration "
                "must not read application config"
            )


def test_model_declares_the_constraint():
    """The model and the migration must agree, or the ORM upsert has no
    ON CONFLICT target to rely on (the same drift that bit 090)."""
    from sqlalchemy import UniqueConstraint

    from app.models.cross_domain import CrossDomainInsight

    unique_pairs = [
        frozenset(c.name for c in uc.columns)
        for uc in CrossDomainInsight.__table__.constraints
        if isinstance(uc, UniqueConstraint)
    ]
    assert frozenset({"user_id", "insight_type"}) in unique_pairs, (
        "model must declare UniqueConstraint(user_id, insight_type); "
        f"found unique constraints: {unique_pairs}"
    )
