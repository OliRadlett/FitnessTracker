"""Add live-sync idempotency keys (lifting_sets.client_id, lifting_sessions.live_key).

Revision ID: 034
Revises: 033
Create Date: 2026-08-25
"""

import sqlalchemy as sa

from alembic import op

revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent set logging from the live-tracker: retries after lost responses
    # dedupe on (session_id, client_id). NULL client_id = manual entry, exempt.
    op.add_column(
        "lifting_sets",
        sa.Column("client_id", sa.String(64), nullable=True),
    )
    op.create_index(
        "uq_lifting_sets_session_client",
        "lifting_sets",
        ["session_id", "client_id"],
        unique=True,
    )

    # Idempotent session creation: concurrent/duplicate create calls carrying the
    # same live_key collapse onto one session. NULL = manual session, exempt.
    op.add_column(
        "lifting_sessions",
        sa.Column("live_key", sa.String(64), nullable=True),
    )
    op.create_index(
        "uq_lifting_sessions_live_key", "lifting_sessions", ["live_key"], unique=True
    )


def downgrade() -> None:
    op.drop_index("uq_lifting_sessions_live_key", table_name="lifting_sessions")
    op.drop_column("lifting_sessions", "live_key")
    op.drop_index("uq_lifting_sets_session_client", table_name="lifting_sets")
    op.drop_column("lifting_sets", "client_id")
