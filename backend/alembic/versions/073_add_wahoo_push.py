"""Add Wahoo push fields to training_plan_days + routes.

Revision ID: 073
Revises: 072
Create Date: 2026-09-24
"""

import sqlalchemy as sa

from alembic import op

revision = "073"
down_revision = "072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # training_plan_days — track what was pushed to Wahoo for a cycle day
    op.add_column(
        "training_plan_days",
        sa.Column("wahoo_plan_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column("wahoo_workout_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column("wahoo_route_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column("wahoo_pushed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column(
            "wahoo_push_workout",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "training_plan_days",
        sa.Column(
            "wahoo_push_route",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # routes — cache the Wahoo route id so a route is uploaded only once
    op.add_column(
        "routes",
        sa.Column("wahoo_route_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "routes",
        sa.Column("wahoo_route_pushed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("routes", "wahoo_route_pushed_at")
    op.drop_column("routes", "wahoo_route_id")

    op.drop_column("training_plan_days", "wahoo_push_route")
    op.drop_column("training_plan_days", "wahoo_push_workout")
    op.drop_column("training_plan_days", "wahoo_pushed_at")
    op.drop_column("training_plan_days", "wahoo_route_id")
    op.drop_column("training_plan_days", "wahoo_workout_id")
    op.drop_column("training_plan_days", "wahoo_plan_id")
