"""Add notes column to personal_records.

Revision ID: 004
Revises: 003
Create Date: 2026-08-16
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "004"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("personal_records", sa.Column("notes", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("personal_records", "notes")
