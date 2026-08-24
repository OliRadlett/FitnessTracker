"""Add warmup_template_id and session_type to training_plan_days.

Revision ID: 030
Revises: 029
Create Date: 2026-08-24
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── warmup_template_id column ─────────────────────────────────────────
    op.add_column(
        "training_plan_days",
        sa.Column(
            "warmup_template_id",
            UUID(as_uuid=True),
            sa.ForeignKey("warmup_templates.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_training_plan_days_warmup_template_id",
        "training_plan_days",
        ["warmup_template_id"],
    )

    # ── session_type column ───────────────────────────────────────────────
    op.add_column(
        "training_plan_days",
        sa.Column("session_type", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("training_plan_days", "session_type")
    op.drop_index(
        "ix_training_plan_days_warmup_template_id",
        table_name="training_plan_days",
    )
    op.drop_column("training_plan_days", "warmup_template_id")
