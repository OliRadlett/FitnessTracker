"""Add lift_videos.lifting_set_id (link a video to a specific set).

Revision ID: 071
Revises: 070
Create Date: 2026-09-22
"""

import sqlalchemy as sa

from alembic import op

revision = "071"
down_revision = "070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lift_videos",
        sa.Column("lifting_set_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_lift_videos_lifting_set_id",
        "lift_videos",
        "lifting_sets",
        ["lifting_set_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_lift_videos_lifting_set_id", "lift_videos", type_="foreignkey"
    )
    op.drop_column("lift_videos", "lifting_set_id")
