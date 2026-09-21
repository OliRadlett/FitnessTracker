"""Add lifting_sessions.estimated_tss (B-31 unified load).

Revision ID: 064
Revises: 063
Create Date: 2026-09-20
"""

import sqlalchemy as sa

from alembic import op

revision = "064"
down_revision = "063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lifting_sessions",
        sa.Column("estimated_tss", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lifting_sessions", "estimated_tss")
