"""Create athlete_insights table (Feature 3 / B-15).

Stores deterministic per-user cross-domain coefficients computed nightly.

Revision ID: 063
Revises: 062
Create Date: 2026-09-20
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "063"
down_revision = "062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "athlete_insights",
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
        sa.Column("period", sa.String(20), nullable=False, server_default="90d"),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("data", postgresql.JSONB(), nullable=True),
        sa.Column("sample_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "confidence",
            sa.String(20),
            nullable=False,
            server_default="collecting",
        ),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_athlete_insights_user_type",
        "athlete_insights",
        ["user_id", "insight_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_athlete_insights_user_type")
    op.drop_table("athlete_insights")
