"""Add Activity.context JSONB cache for precomputed ride analytics (§1.3).

Revision ID: 046
Revises: 045
Create Date: 2026-09-08
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "046"
down_revision = "045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activities",
        sa.Column("context", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("activities", "context")
