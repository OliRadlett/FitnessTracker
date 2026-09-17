"""Create cycling_power_records table and add max_power to activities.

Adds a table to track cycling power PRs (best power at each duration
bucket) alongside the existing lifting PersonalRecord system. Also
captures the peak 1-second power (max_watts) from Strava onto the
activities table.

Revision ID: 054
Revises: 053
Create Date: 2026-09-16
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cycling_power_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "duration_label", sa.String(20), nullable=False, index=True
        ),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("power_watts", sa.Float(), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=True),
        sa.Column("w_per_kg", sa.Float(), nullable=True),
        sa.Column("improvement_pct", sa.Float(), nullable=True),
        sa.Column(
            "achieved_date", sa.Date(), nullable=False, index=True
        ),
        sa.Column(
            "activity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "user_id",
            "duration_label",
            name="uq_cycling_power_records_user_duration",
        ),
    )
    op.add_column(
        "activities",
        sa.Column("max_power", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_cycling_power_records_user_duration",
        "cycling_power_records",
        type_="unique",
    )
    op.drop_table("cycling_power_records")
    op.drop_column("activities", "max_power")
