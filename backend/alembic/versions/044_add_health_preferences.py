"""Add per-user health alert preferences (snooze/disable/threshold overrides).

Revision ID: 044
Revises: 043
Create Date: 2026-09-08
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "044"
down_revision = "043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("health_preferences", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "health_preferences")
