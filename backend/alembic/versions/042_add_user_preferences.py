"""Add per-user UI preferences (unit system, locale, time format).

Revision ID: 042
Revises: 041
Create Date: 2026-09-07
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("preferences", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("users", "preferences")
