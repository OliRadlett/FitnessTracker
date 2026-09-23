"""Add lift_videos.bar_path_json (bar-path technique metrics, F1).

Revision ID: 069
Revises: 068
Create Date: 2026-09-22
"""

import sqlalchemy as sa

from alembic import op

revision = "069"
down_revision = "068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lift_videos",
        sa.Column("bar_path_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lift_videos", "bar_path_json")
