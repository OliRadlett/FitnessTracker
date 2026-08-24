"""Add sport-aware planning fields to training plan days and event link to plans.

Revision ID: 027
Revises: 026
Create Date: 2026-08-24
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Sport-aware day fields (Phase 5A). Existing rows default to "cycle".
    op.add_column(
        "training_plan_days",
        sa.Column(
            "sport",
            sa.String(length=20),
            nullable=False,
            server_default="cycle",
        ),
    )
    op.add_column(
        "training_plan_days",
        sa.Column("workout_description", sa.String(length=1000), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column("planned_focus", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column("planned_exercises", JSONB(), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column("planned_volume_kg", sa.Float(), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column("planned_rpe", sa.Float(), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column("planned_power_watts", sa.Float(), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column("planned_zone", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column(
            "planned_route_id",
            UUID(as_uuid=True),
            sa.ForeignKey("routes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "training_plan_days",
        sa.Column(
            "lifting_session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("lifting_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Event-plan linkage with auto-taper.
    op.add_column(
        "training_plans",
        sa.Column(
            "event_id",
            UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("training_plans", "event_id")
    op.drop_column("training_plan_days", "lifting_session_id")
    op.drop_column("training_plan_days", "planned_route_id")
    op.drop_column("training_plan_days", "planned_zone")
    op.drop_column("training_plan_days", "planned_power_watts")
    op.drop_column("training_plan_days", "planned_rpe")
    op.drop_column("training_plan_days", "planned_volume_kg")
    op.drop_column("training_plan_days", "planned_exercises")
    op.drop_column("training_plan_days", "planned_focus")
    op.drop_column("training_plan_days", "workout_description")
    op.drop_column("training_plan_days", "sport")
