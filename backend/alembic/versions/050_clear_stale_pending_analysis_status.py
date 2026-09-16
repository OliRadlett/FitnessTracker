"""Clear stale 'pending' analysis_status on existing lift_videos.

Videos that existed before video processing was added shouldn't show as
'queued' — set their analysis_status to NULL so they display as normal
uploads.

Revision ID: 050
Revises: 049
Create Date: 2026-09-16
"""

from alembic import op

revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE lift_videos SET analysis_status = NULL "
        "WHERE analysis_status = 'pending'"
    )


def downgrade() -> None:
    pass
