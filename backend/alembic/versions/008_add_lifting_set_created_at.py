"""Add created_at to lifting_sets for chronological ordering.

Revision ID: 008
Revises: 007
Create Date: 2026-08-16
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add created_at column with server default
    op.add_column(
        "lifting_sets",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )

    # Backfill existing rows: use the session's created_at + a small offset per set_number
    op.execute("""
        UPDATE lifting_sets ls
        SET created_at = (
            SELECT s.created_at + (ls.set_number || ' seconds')::interval
            FROM lifting_sessions s
            WHERE s.id = ls.session_id
        )
        WHERE ls.created_at IS NULL
    """)

    # Make it NOT NULL after backfill
    op.alter_column("lifting_sets", "created_at", nullable=False)


def downgrade() -> None:
    op.drop_column("lifting_sets", "created_at")
