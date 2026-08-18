"""Add weight_logs table for body weight tracking.

Revision ID: 011
Revises: 010
Create Date: 2026-08-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Check if table already exists (created by Base.metadata.create_all on startup)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "weight_logs" not in inspector.get_table_names():
        op.create_table(
            "weight_logs",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("date", sa.Date, nullable=False, index=True),
            sa.Column("weight_kilogram", sa.Float, nullable=False),
            sa.Column("source", sa.String(50), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("user_id", "date", "source", name="uq_weight_log_user_date_source"),
        )


def downgrade() -> None:
    op.drop_table("weight_logs")
