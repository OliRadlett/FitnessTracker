"""Add event result block columns (finishing time, position, PB).

Revision ID: 041
Revises: 040
Create Date: 2026-09-07
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "041"
down_revision = "040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("result", JSONB, nullable=True))
    op.add_column(
        "events",
        sa.Column(
            "result_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("events", "result_updated_at")
    op.drop_column("events", "result")
