"""Add lift_videos lifter selection columns (multi-person tracking, T1).

Revision ID: 068
Revises: 067
Create Date: 2026-09-22
"""

import sqlalchemy as sa

from alembic import op

revision = "068"
down_revision = "067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lift_videos",
        sa.Column("lifter_selected", sa.Integer(), nullable=True),
    )
    op.add_column(
        "lift_videos",
        sa.Column("lifter_selection_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lift_videos", "lifter_selection_json")
    op.drop_column("lift_videos", "lifter_selected")
