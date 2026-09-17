"""Create rpe_calibrations table for per-user AI vs user RPE offset tracking (§3.18).

Stores rolling statistics (mean_delta, std_delta) comparing AI-estimated RPE
to user-entered RPE. Used to auto-calibrate future RPE estimates.

Revision ID: 052
Revises: 051
Create Date: 2026-09-16
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rpe_calibrations",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("exercise_name", sa.String(255), nullable=True),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "mean_delta", sa.Float(), nullable=False, server_default="0.0"
        ),
        sa.Column(
            "std_delta", sa.Float(), nullable=False, server_default="0.0"
        ),
        sa.Column("exercise_breakdown", sa.Text(), nullable=True),
        sa.Column("last_updated", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_rpe_calibrations_user_exercise",
        "rpe_calibrations",
        ["user_id", "exercise_name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_rpe_calibrations_user_exercise", table_name="rpe_calibrations")
    op.drop_table("rpe_calibrations")
