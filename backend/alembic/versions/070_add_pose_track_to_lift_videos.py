"""Add lift_videos.pose_track_r2_key + analysis_version (T5).

Revision ID: 070
Revises: 069
Create Date: 2026-09-22
"""

import sqlalchemy as sa

from alembic import op

revision = "070"
down_revision = "069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lift_videos",
        sa.Column("pose_track_r2_key", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "lift_videos",
        sa.Column("analysis_version", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lift_videos", "analysis_version")
    op.drop_column("lift_videos", "pose_track_r2_key")
