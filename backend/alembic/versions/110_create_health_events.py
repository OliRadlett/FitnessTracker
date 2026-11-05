"""Create user-marked health events (illness/injury/fatigue periods).

Revision ID: 110
Revises: 109
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "110"
down_revision = "109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("event_type", sa.String(length=16), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "event_type IN ('illness', 'injury', 'fatigue', 'other')",
            name="ck_health_events_type",
        ),
        sa.CheckConstraint(
            "severity IN ('mild', 'moderate', 'severe')",
            name="ck_health_events_severity",
        ),
        sa.CheckConstraint(
            "end_date IS NULL OR end_date >= start_date",
            name="ck_health_events_dates",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_health_events_user_start",
        "health_events",
        ["user_id", "start_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_health_events_user_start", table_name="health_events")
    op.drop_table("health_events")
