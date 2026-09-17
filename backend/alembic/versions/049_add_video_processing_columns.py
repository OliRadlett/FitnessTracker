"""Add video processing columns to lift_videos (§1.1 trim + classify).

Adds columns for Modal-powered video processing: trimmed R2 key, analysis
status/results, auto-detected exercise/reps/weight, and trim timestamps.

Revision ID: 049
Revises: 048
Create Date: 2026-09-16
"""

import sqlalchemy as sa

from alembic import op

revision = "049"
down_revision = "048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lift_videos",
        sa.Column("trimmed_r2_key", sa.String(255), nullable=True),
    )
    op.add_column(
        "lift_videos",
        sa.Column(
            "analysis_status",
            sa.String(20),
            nullable=True,
            server_default="pending",
        ),
    )
    op.add_column(
        "lift_videos",
        sa.Column("analysis_text", sa.Text(), nullable=True),
    )
    op.add_column(
        "lift_videos",
        sa.Column("exercise_auto", sa.String(100), nullable=True),
    )
    op.add_column(
        "lift_videos",
        sa.Column("reps_count", sa.Integer(), nullable=True),
    )
    op.add_column(
        "lift_videos",
        sa.Column("weight_kg", sa.Float(), nullable=True),
    )
    op.add_column(
        "lift_videos",
        sa.Column("confidence", sa.Float(), nullable=True),
    )
    op.add_column(
        "lift_videos",
        sa.Column("trim_start_sec", sa.Float(), nullable=True),
    )
    op.add_column(
        "lift_videos",
        sa.Column("trim_end_sec", sa.Float(), nullable=True),
    )
    op.add_column(
        "lift_videos",
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lift_videos", "processed_at")
    op.drop_column("lift_videos", "trim_end_sec")
    op.drop_column("lift_videos", "trim_start_sec")
    op.drop_column("lift_videos", "confidence")
    op.drop_column("lift_videos", "weight_kg")
    op.drop_column("lift_videos", "reps_count")
    op.drop_column("lift_videos", "exercise_auto")
    op.drop_column("lift_videos", "analysis_text")
    op.drop_column("lift_videos", "analysis_status")
    op.drop_column("lift_videos", "trimmed_r2_key")
