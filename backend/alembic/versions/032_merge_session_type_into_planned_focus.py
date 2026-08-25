"""Merge session_type into planned_focus and drop session_type column.

Revision ID: 032
Revises: 031
Create Date: 2026-08-25
"""

import sqlalchemy as sa

from alembic import op

revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None

# session_type values that need migrating into planned_focus (which didn't
# already exist there).  "full_body" overlaps and is left as-is.
_MIGRATION_MAP = {
    "push": "push",
    "pull": "pull",
    "legs": "legs",
    "upper": "upper",
    "lower": "lower",
}


def upgrade() -> None:
    conn = op.get_bind()

    # Copy non-overlapping session_type values into planned_focus where
    # planned_focus is currently NULL.
    for src, dst in _MIGRATION_MAP.items():
        conn.execute(
            sa.text(
                "UPDATE training_plan_days "
                "SET planned_focus = :dst "
                "WHERE session_type = :src AND planned_focus IS NULL"
            ),
            {"src": src, "dst": dst},
        )

    # Drop the session_type column.
    op.drop_column("training_plan_days", "session_type")


def downgrade() -> None:
    op.add_column(
        "training_plan_days",
        sa.Column("session_type", sa.String(length=20), nullable=True),
    )
    # Best-effort reverse: move push/pull/legs/upper/lower back from
    # planned_focus to session_type where they came from.
    conn = op.get_bind()
    for src, dst in _MIGRATION_MAP.items():
        conn.execute(
            sa.text(
                "UPDATE training_plan_days "
                "SET session_type = :dst, planned_focus = NULL "
                "WHERE planned_focus = :dst"
            ),
            {"src": src, "dst": dst},
        )
