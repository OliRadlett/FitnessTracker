"""Create lift_video_analyses table for weekly trend aggregation per exercise (§3.18).

Populated by the weekly aggregate_video_analyses Celery task. Stores rolling
averages and JSONB trend arrays for form score, velocity, and consistency.

Revision ID: 053
Revises: 052
Create Date: 2026-09-16
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lift_video_analyses",
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
        sa.Column("exercise_name", sa.String(255), nullable=False, index=True),
        sa.Column("avg_form_score", sa.Float(), nullable=True),
        sa.Column("avg_velocity", sa.Float(), nullable=True),
        sa.Column("avg_consistency", sa.Float(), nullable=True),
        sa.Column("avg_rpe_accuracy", sa.Float(), nullable=True),
        sa.Column(
            "video_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("form_trend", sa.Text(), nullable=True),
        sa.Column("velocity_trend", sa.Text(), nullable=True),
        sa.Column("consistency_trend", sa.Text(), nullable=True),
        sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_lift_video_analyses_user_exercise",
        "lift_video_analyses",
        ["user_id", "exercise_name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_lift_video_analyses_user_exercise",
        table_name="lift_video_analyses",
    )
    op.drop_table("lift_video_analyses")
