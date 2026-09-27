"""Route merging overhaul: merge log + similarity cache.

Revision ID: 079
Revises: 078
Create Date: 2026-09-26

Adds the audit trail for non-destructive route merges (`route_merge_log`) and
the cached pairwise similarity graph (`route_similarity`) produced by the
weekly `recompute_route_similarity` Modal task. RouteSource user-scoping and
the `routes.predicted_effort` drop landed separately in 076/077.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "079"
down_revision = "078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "route_merge_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "primary_route_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("routes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("merged_route_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("breakdown", postgresql.JSONB(), nullable=True),
        sa.Column("snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("moved", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_route_merge_log_user_id", "route_merge_log", ["user_id"])
    op.create_index(
        "ix_route_merge_log_primary_route_id", "route_merge_log", ["primary_route_id"]
    )
    op.create_index(
        "ix_route_merge_log_merged_route_id", "route_merge_log", ["merged_route_id"]
    )

    op.create_table(
        "route_similarity",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "route_a_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("routes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "route_b_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("routes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("tier", sa.String(length=20), nullable=False, server_default="none"),
        sa.Column("breakdown", postgresql.JSONB(), nullable=True),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "route_a_id", "route_b_id", name="uq_route_similarity_pair"
        ),
    )
    op.create_index("ix_route_similarity_user_id", "route_similarity", ["user_id"])
    op.create_index(
        "ix_route_similarity_route_a_id", "route_similarity", ["route_a_id"]
    )
    op.create_index(
        "ix_route_similarity_route_b_id", "route_similarity", ["route_b_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_route_similarity_route_b_id", table_name="route_similarity")
    op.drop_index("ix_route_similarity_route_a_id", table_name="route_similarity")
    op.drop_index("ix_route_similarity_user_id", table_name="route_similarity")
    op.drop_table("route_similarity")

    op.drop_index("ix_route_merge_log_merged_route_id", table_name="route_merge_log")
    op.drop_index("ix_route_merge_log_primary_route_id", table_name="route_merge_log")
    op.drop_index("ix_route_merge_log_user_id", table_name="route_merge_log")
    op.drop_table("route_merge_log")
