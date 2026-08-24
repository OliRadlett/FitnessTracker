"""Add live-session tracking and Whoop enrichment columns to lifting_sessions.

Revision ID: 028
Revises: 027
Create Date: 2026-08-24
"""

import sqlalchemy as sa

from alembic import op

revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lifting_sessions",
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "lifting_sessions",
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "lifting_sessions",
        sa.Column("whoop_strain", sa.Float(), nullable=True),
    )
    op.add_column(
        "lifting_sessions",
        sa.Column("whoop_avg_hr", sa.Integer(), nullable=True),
    )
    op.add_column(
        "lifting_sessions",
        sa.Column("whoop_max_hr", sa.Integer(), nullable=True),
    )
    op.add_column(
        "lifting_sessions",
        sa.Column("whoop_kilojoules", sa.Float(), nullable=True),
    )
    op.add_column(
        "lifting_sessions",
        sa.Column("whoop_workout_id", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lifting_sessions", "whoop_workout_id")
    op.drop_column("lifting_sessions", "whoop_kilojoules")
    op.drop_column("lifting_sessions", "whoop_max_hr")
    op.drop_column("lifting_sessions", "whoop_avg_hr")
    op.drop_column("lifting_sessions", "whoop_strain")
    op.drop_column("lifting_sessions", "ended_at")
    op.drop_column("lifting_sessions", "started_at")
