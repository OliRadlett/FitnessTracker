"""Add route_id FK to activities for activity↔route auto-linking.

Revision ID: 010
Revises: 009
Create Date: 2026-08-16
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers
revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add route_id column to activities table
    op.add_column(
        "activities",
        sa.Column("route_id", UUID(as_uuid=True), sa.ForeignKey("routes.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_activities_route_id", "activities", ["route_id"])


def downgrade() -> None:
    op.drop_index("ix_activities_route_id", table_name="activities")
    op.drop_column("activities", "route_id")
