"""Add connection health columns to oauth_connections (BUG-072).

Adds status/consecutive_failures/last_error_at/last_error/last_refreshed_at
so a revoked or repeatedly-failing provider token is marked needs_reauth and
surfaced in the UI instead of being retried every 30 minutes indefinitely.

Revision ID: 035
Revises: 034
Create Date: 2026-08-26
"""

import sqlalchemy as sa

from alembic import op

revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "oauth_connections",
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
    )
    op.add_column(
        "oauth_connections",
        sa.Column(
            "consecutive_failures", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "oauth_connections",
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "oauth_connections",
        sa.Column("last_error", sa.String(500), nullable=True),
    )
    op.add_column(
        "oauth_connections",
        sa.Column("last_refreshed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("oauth_connections", "last_refreshed_at")
    op.drop_column("oauth_connections", "last_error")
    op.drop_column("oauth_connections", "last_error_at")
    op.drop_column("oauth_connections", "consecutive_failures")
    op.drop_column("oauth_connections", "status")