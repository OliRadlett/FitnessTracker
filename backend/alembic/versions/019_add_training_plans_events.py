"""add training plans, plan days, and events tables

Revision ID: 019
Revises: 018
Create Date: 2026-08-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Training Plans
    op.create_table(
        "training_plans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.String(1000), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("plan_type", sa.String(50), nullable=False, server_default="custom"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Training Plan Days
    op.create_table(
        "training_plan_days",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("training_plans.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("day_date", sa.Date(), nullable=False, index=True),
        sa.Column("planned_tss", sa.Float(), nullable=True),
        sa.Column("planned_duration_min", sa.Integer(), nullable=True),
        sa.Column("planned_type", sa.String(20), nullable=False, server_default="rest"),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("activity_id", UUID(as_uuid=True), sa.ForeignKey("activities.id", ondelete="SET NULL"), nullable=True),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Events
    op.create_table(
        "events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False, index=True),
        sa.Column("event_type", sa.String(50), nullable=False, server_default="race"),
        sa.Column("target_tss", sa.Float(), nullable=True),
        sa.Column("taper_days", sa.Integer(), nullable=False, server_default="14"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("events")
    op.drop_table("training_plan_days")
    op.drop_table("training_plans")
