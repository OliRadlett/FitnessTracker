"""Add lift_videos.camera_lens (per-video lens picker, plans/bar-tracking-3d.md).

Which phone lens filmed the clip (main / ultra_wide / telephoto), declared
by the lifter in the uploader. The scheduler maps it to a nominal focal via
services/video_camera.py — the fallback used when the container carries no
lens tags (measured: none of the real clips do).

Revision ID: 086
Revises: 085
Create Date: 2026-09-29
"""

import sqlalchemy as sa

from alembic import op

revision = "086"
down_revision = "085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lift_videos",
        sa.Column("camera_lens", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lift_videos", "camera_lens")
