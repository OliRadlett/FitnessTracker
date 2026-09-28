"""Add lift_videos.camera_json (per-clip camera, plans/bar-tracking-3d.md).

The metric 3D bar path is only as good as the calibration behind it: the
container metadata gives the clip's focal length in pixels, and MediaPipe's
world landmarks need the lifter's height to be metric. Storing the camera
alongside the analysis means a surprising bar height can be traced to the lens
it was measured through.

Revision ID: 083
Revises: 082
Create Date: 2026-09-28
"""

import sqlalchemy as sa

from alembic import op

revision = "083"
down_revision = "082"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lift_videos",
        sa.Column("camera_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lift_videos", "camera_json")
