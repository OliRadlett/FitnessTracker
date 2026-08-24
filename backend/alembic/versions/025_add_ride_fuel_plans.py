"""add_ride_fuel_plans

Revision ID: 025
Revises: 024
Create Date: 2026-08-24
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ride_fuel_plans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "activity_id",
            UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="CASCADE"),
            nullable=True,
            unique=True,
            index=True,
        ),
        sa.Column("planned_duration_min", sa.Integer(), nullable=True),
        sa.Column("planned_if", sa.Float(), nullable=True),
        sa.Column("pre_ride_carbs_g", sa.Float(), nullable=True),
        sa.Column("during_carbs_per_hour_g", sa.Float(), nullable=True),
        sa.Column("during_hydration_ml_per_hour", sa.Float(), nullable=True),
        sa.Column("during_sodium_mg_per_hour", sa.Float(), nullable=True),
        sa.Column("post_ride_carbs_g", sa.Float(), nullable=True),
        sa.Column("post_ride_protein_g", sa.Float(), nullable=True),
        sa.Column("schedule_json", JSONB(), nullable=True),
        sa.Column("actual_pre_ride_notes", sa.String(length=1000), nullable=True),
        sa.Column("actual_during_notes", sa.String(length=1000), nullable=True),
        sa.Column("actual_post_ride_notes", sa.String(length=1000), nullable=True),
        sa.Column(
            "source", sa.String(length=20), nullable=False, server_default="auto"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("ride_fuel_plans")
