"""add_llm_analyses

Revision ID: 020
Revises: 019
Create Date: 2026-08-20
"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("analysis_date", sa.Date(), nullable=False, index=True),
        sa.Column("stats_json", postgresql.JSONB(), nullable=False),
        sa.Column("analysis_text", sa.Text(), nullable=False),
        sa.Column("model_used", sa.String(100), nullable=False, server_default="gemini-2.0-flash"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("llm_analyses")
