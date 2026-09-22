"""Add lift_videos.overlay_r2_key (skeleton/bar-path overlay video).

Revision ID: 066
Revises: 065
Create Date: 2026-09-21
"""

import sqlalchemy as sa

from alembic import op

revision = "066"
down_revision = "065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lift_videos",
        sa.Column("overlay_r2_key", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lift_videos", "overlay_r2_key")
