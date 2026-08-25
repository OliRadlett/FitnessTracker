"""Add last_synced_at watermark to oauth_connections.

Revision ID: 031
Revises: 030
Create Date: 2026-08-25
"""

import sqlalchemy as sa

from alembic import op

revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "oauth_connections",
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("oauth_connections", "last_synced_at")
