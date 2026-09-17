"""Add terrain classification and effort prediction to routes.

Adds JSONB columns for terrain analysis (climb categories, gradient
statistics, terrain type) and cached effort predictions from the
Modal-powered route intelligence pipeline.

Revision ID: 055
Revises: 054
Create Date: 2026-09-17
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "055"
down_revision = "054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "routes",
        sa.Column("terrain_classification", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "routes",
        sa.Column("predicted_effort", postgresql.JSONB(), nullable=True),
    )
    # Index for terrain type filtering (GIN for JSONB)
    op.execute(
        "CREATE INDEX ix_routes_terrain_type ON routes "
        "USING btree ((terrain_classification->>'terrain_type'))"
    )
    # Add terrain quality score to route_quality
    op.add_column(
        "route_quality",
        sa.Column("terrain_quality_score", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("route_quality", "terrain_quality_score")
    op.drop_index("ix_routes_terrain_type", postgresql=True)
    op.drop_column("routes", "predicted_effort")
    op.drop_column("routes", "terrain_classification")
