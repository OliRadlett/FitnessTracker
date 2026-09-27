"""Route matching Phase 2: OSM road-graph match + route embedding.

Revision ID: 080
Revises: 079
Create Date: 2026-09-27

Adds nullable JSONB columns to ``routes`` for the Phase-2 road-graph layer:
``road_match`` (matched OSM edge set + coverage), ``road_embedding`` (feature
vector + learned metric version) and ``road_match_version`` (invalidation).
No backfill needed — rows populate on the weekly ``map_match_routes`` task.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "080"
down_revision = "079"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("routes", sa.Column("road_match", postgresql.JSONB(), nullable=True))
    op.add_column(
        "routes", sa.Column("road_embedding", postgresql.JSONB(), nullable=True)
    )
    op.add_column(
        "routes", sa.Column("road_match_version", sa.Integer(), nullable=True)
    )
    op.create_table(
        "route_match_metric",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("weights", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("n_positives", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("n_negatives", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "trained_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("route_match_metric")
    op.drop_column("routes", "road_match_version")
    op.drop_column("routes", "road_embedding")
    op.drop_column("routes", "road_match")
