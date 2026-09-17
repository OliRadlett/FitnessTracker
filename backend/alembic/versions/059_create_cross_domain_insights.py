"""Create cross_domain_insights table.

Stores weekly cross-domain correlation analysis results (sleep-performance,
cross-sport fatigue, race retrospective) computed by Modal.

Revision ID: 059
Revises: 058
Create Date: 2026-09-17
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "059"
down_revision = "058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cross_domain_insights",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("insight_type", sa.String(50), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("results", postgresql.JSONB(), nullable=True),
        sa.Column("insights", postgresql.JSONB(), nullable=True),
        sa.Column("data_quality", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    # Index for querying by user + type
    op.create_index(
        "ix_cross_domain_insights_user_type",
        "cross_domain_insights",
        ["user_id", "insight_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_cross_domain_insights_user_type")
    op.drop_table("cross_domain_insights")
