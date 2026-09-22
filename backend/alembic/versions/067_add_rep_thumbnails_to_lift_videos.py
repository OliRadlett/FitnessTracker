"""Add lift_videos.rep_thumbnails_r2_key (per-rep sprite sheet).

Revision ID: 067
Revises: 066
Create Date: 2026-09-22
"""

import sqlalchemy as sa

from alembic import op

revision = "067"
down_revision = "066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lift_videos",
        sa.Column("rep_thumbnails_r2_key", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lift_videos", "rep_thumbnails_r2_key")
