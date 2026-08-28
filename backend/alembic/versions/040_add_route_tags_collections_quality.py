"""Add route tags, collections, and quality scoring tables.

Revision ID: 040
Revises: 039
Create Date: 2026-08-28
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "040"
down_revision = "039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Route tags (user-defined, flat, multi-assign)
    op.create_table(
        "route_tags",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("user_id", "name", name="uq_route_tag_user_name"),
    )

    # Many-to-many: routes <-> tags
    op.create_table(
        "route_taggings",
        sa.Column("route_id", UUID(as_uuid=True), sa.ForeignKey("routes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", UUID(as_uuid=True), sa.ForeignKey("route_tags.id", ondelete="CASCADE"), primary_key=True),
        sa.Column(
            "tagged_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # Route collections (manual groups or smart/rule-based)
    op.create_table(
        "route_collections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("icon", sa.String(length=50), nullable=True),
        sa.Column("color", sa.String(length=7), nullable=True),
        sa.Column("is_smart", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("rules", JSONB(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # Manual collection membership (only for non-smart collections)
    op.create_table(
        "route_collection_items",
        sa.Column("collection_id", UUID(as_uuid=True), sa.ForeignKey("route_collections.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("route_id", UUID(as_uuid=True), sa.ForeignKey("routes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # Route quality scores (cached, computed by nightly task)
    op.create_table(
        "route_quality",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "route_id",
            UUID(as_uuid=True),
            sa.ForeignKey("routes.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("completeness_score", sa.Float(), nullable=True),
        sa.Column("popularity_score", sa.Float(), nullable=True),
        sa.Column("surface_quality_score", sa.Float(), nullable=True),
        sa.Column("effort_match_score", sa.Float(), nullable=True),
        sa.Column("overall_score", sa.Float(), nullable=True),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # Add quality_score + is_favorite to routes table for fast list filtering
    op.add_column("routes", sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("routes", sa.Column("quality_score", sa.Float(), nullable=True))
    op.create_index("ix_routes_quality_score", "routes", ["quality_score"])
    op.create_index("ix_routes_is_favorite", "routes", ["is_favorite"])


def downgrade() -> None:
    op.drop_index("ix_routes_is_favorite", table_name="routes")
    op.drop_index("ix_routes_quality_score", table_name="routes")
    op.drop_column("routes", "quality_score")
    op.drop_column("routes", "is_favorite")
    op.drop_table("route_quality")
    op.drop_table("route_collection_items")
    op.drop_table("route_collections")
    op.drop_table("route_taggings")
    op.drop_table("route_tags")
