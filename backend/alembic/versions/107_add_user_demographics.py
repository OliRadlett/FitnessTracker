"""Add optional user demographics for age/sex-adjusted VO2max bands.

Revision ID: 107
Revises: 106
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "107"
down_revision = "106"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("birth_date", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("sex", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "sex")
    op.drop_column("users", "birth_date")
