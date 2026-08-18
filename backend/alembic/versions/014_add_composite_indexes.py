"""add surface_profile to routes

Revision ID: 014
Revises: 013
Create Date: 2026-08-17
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("routes", sa.Column("surface_profile", JSONB, nullable=True))
