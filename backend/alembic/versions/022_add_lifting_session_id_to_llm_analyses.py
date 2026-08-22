"""add_lifting_session_id_to_llm_analyses

Revision ID: 022
Revises: 021
Create Date: 2026-08-21
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "llm_analyses",
        sa.Column(
            "lifting_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("lifting_sessions.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("llm_analyses", "lifting_session_id")
