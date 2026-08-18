"""Add lactate_threshold_hr to cycling_profiles.

Revision ID: 012
Revises: 011
Create Date: 2026-08-17
"""
from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cycling_profiles", sa.Column("lactate_threshold_hr", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("cycling_profiles", "lactate_threshold_hr")
