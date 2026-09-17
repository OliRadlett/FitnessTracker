"""Add intelligence fields to segments.

Stores cluster assignment, climb type, difficulty score, and personal
effort predictions fitted by the weekly Modal segment analysis task.

Revision ID: 058
Revises: 057
Create Date: 2026-09-17
"""

import sqlalchemy as sa

from alembic import op

revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "segments",
        sa.Column("cluster_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "segments",
        sa.Column("climb_type", sa.String(30), nullable=True),
    )
    op.add_column(
        "segments",
        sa.Column("sustainedness", sa.Float(), nullable=True),
    )
    op.add_column(
        "segments",
        sa.Column("difficulty_score", sa.Float(), nullable=True),
    )
    op.add_column(
        "segments",
        sa.Column("predicted_vam", sa.Float(), nullable=True),
    )
    op.add_column(
        "segments",
        sa.Column("predicted_time_seconds", sa.Float(), nullable=True),
    )
    op.add_column(
        "segments",
        sa.Column("predicted_power_watts", sa.Float(), nullable=True),
    )
    op.add_column(
        "segments",
        sa.Column("prediction_confidence", sa.Float(), nullable=True),
    )
    op.add_column(
        "segments",
        sa.Column(
            "intelligence_analyzed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    # Index for cluster-based queries
    op.create_index(
        "ix_segments_cluster_id",
        "segments",
        ["cluster_id"],
        postgresql_where="cluster_id IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_index("ix_segments_cluster_id", postgresql=True)
    op.drop_column("segments", "intelligence_analyzed_at")
    op.drop_column("segments", "prediction_confidence")
    op.drop_column("segments", "predicted_power_watts")
    op.drop_column("segments", "predicted_time_seconds")
    op.drop_column("segments", "predicted_vam")
    op.drop_column("segments", "difficulty_score")
    op.drop_column("segments", "sustainedness")
    op.drop_column("segments", "climb_type")
    op.drop_column("segments", "cluster_id")
