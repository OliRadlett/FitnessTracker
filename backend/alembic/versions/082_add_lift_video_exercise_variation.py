"""add lift_videos.exercise_variation (pose sub-style label)

Revision ID: 082
Revises: 081
Create Date: 2026-09-28
"""

import sqlalchemy as sa

from alembic import op

revision = "082"
down_revision = "081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lift_videos",
        sa.Column("exercise_variation", sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lift_videos", "exercise_variation")
