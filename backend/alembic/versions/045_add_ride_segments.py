"""Add ride segments + segment efforts (§3.13).

Revision ID: 045
Revises: 044
Create Date: 2026-09-08
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "045"
down_revision = "044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "segments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "route_id",
            UUID(as_uuid=True),
            sa.ForeignKey("routes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("start_dist_m", sa.Float(), nullable=False),
        sa.Column("end_dist_m", sa.Float(), nullable=False),
        sa.Column("distance_m", sa.Float(), nullable=False),
        sa.Column("elevation_gain_m", sa.Float(), nullable=False),
        sa.Column("avg_gradient_pct", sa.Float(), nullable=False),
        sa.Column("max_gradient_pct", sa.Float(), nullable=False),
        sa.Column("peak_elevation_m", sa.Float(), nullable=True),
        sa.Column("start_lat", sa.Float(), nullable=False),
        sa.Column("start_lng", sa.Float(), nullable=False),
        sa.Column("end_lat", sa.Float(), nullable=False),
        sa.Column("end_lng", sa.Float(), nullable=False),
        sa.Column("climb_category", sa.String(10), nullable=True),
        sa.Column("pr_seconds", sa.Float(), nullable=True),
        sa.Column("best_avg_power_watts", sa.Float(), nullable=True),
        sa.Column("times_ridden", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("has_pr", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "route_id", "start_dist_m", "end_dist_m", name="uq_segments_route_range"
        ),
    )
    op.create_index("ix_segments_user_id", "segments", ["user_id"])
    op.create_index("ix_segments_route_id", "segments", ["route_id"])

    op.create_table(
        "segment_efforts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "segment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("segments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "activity_id",
            UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("elapsed_seconds", sa.Float(), nullable=False),
        sa.Column("avg_power_watts", sa.Float(), nullable=True),
        sa.Column("avg_hr", sa.Float(), nullable=True),
        sa.Column("avg_speed_mps", sa.Float(), nullable=False),
        sa.Column("effort_vam", sa.Float(), nullable=True),
        sa.Column("is_pr", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "segment_id", "activity_id", name="uq_segment_efforts_segment_activity"
        ),
    )
    op.create_index("ix_segment_efforts_segment_id", "segment_efforts", ["segment_id"])
    op.create_index(
        "ix_segment_efforts_activity_id", "segment_efforts", ["activity_id"]
    )


def downgrade() -> None:
    op.drop_table("segment_efforts")
    op.drop_table("segments")
