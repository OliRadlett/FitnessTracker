"""Add ``plan_review_snapshots`` (C3 — scheduled weekly review).

One row per weekly review of a plan. The review composes conformity, training
load, adaptive advice and goals into a JSONB snapshot, computed once a week by
the ``weekly_plan_review`` beat task and read back by ``GET /{id}/review``.

The ``(plan_id, week_start)`` unique constraint makes the task idempotent: a
re-run in the same week is a no-op rather than a duplicate snapshot.

Dialect note: ``JSONB`` comes from ``sqlalchemy.dialects.postgresql`` (AGENTS.md
pitfall 22 — ``sa.JSONB()`` does not exist and reverts the whole migration).

Revision ID: 101
Revises: 100
Create Date: 2026-10-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "101"
down_revision = "100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "plan_review_snapshots",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "plan_id",
            sa.UUID(),
            sa.ForeignKey("training_plans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "plan_id", "week_start", name="uq_plan_review_snapshots_plan_week"
        ),
    )
    op.create_index(
        "ix_plan_review_snapshots_user_id", "plan_review_snapshots", ["user_id"]
    )
    op.create_index(
        "ix_plan_review_snapshots_plan_id", "plan_review_snapshots", ["plan_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_plan_review_snapshots_plan_id", table_name="plan_review_snapshots"
    )
    op.drop_index(
        "ix_plan_review_snapshots_user_id", table_name="plan_review_snapshots"
    )
    op.drop_table("plan_review_snapshots")
