"""Add lift_videos.camera_view (user-declared camera angle).

Revision ID: 065
Revises: 064
Create Date: 2026-09-21
"""

import sqlalchemy as sa

from alembic import op

revision = "065"
down_revision = "064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lift_videos",
        sa.Column("camera_view", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lift_videos", "camera_view")
