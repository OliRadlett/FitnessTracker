"""add lifting_sessions.ai_tags (Jev free-text tags)

Revision ID: 081
Revises: 080
Create Date: 2026-09-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "081"
down_revision = "080"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lifting_sessions",
        sa.Column("ai_tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lifting_sessions", "ai_tags")
