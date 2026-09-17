"""Add personalized power model fields to cycling_profiles.

Adds columns for critical power (CP), W', personalized VO2max, and
adaptive CTL/ATL time constants fitted by the weekly Modal task.

Revision ID: 056
Revises: 055
Create Date: 2026-09-17
"""

import sqlalchemy as sa

from alembic import op

revision = "056"
down_revision = "055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cycling_profiles",
        sa.Column("critical_power", sa.Float(), nullable=True),
    )
    op.add_column(
        "cycling_profiles",
        sa.Column("w_prime", sa.Float(), nullable=True),
    )
    op.add_column(
        "cycling_profiles",
        sa.Column("power_model_r_squared", sa.Float(), nullable=True),
    )
    op.add_column(
        "cycling_profiles",
        sa.Column("personalized_vo2max", sa.Float(), nullable=True),
    )
    op.add_column(
        "cycling_profiles",
        sa.Column("ctl_tau", sa.Integer(), nullable=True),
    )
    op.add_column(
        "cycling_profiles",
        sa.Column("atl_tau", sa.Integer(), nullable=True),
    )
    op.add_column(
        "cycling_profiles",
        sa.Column(
            "power_model_fitted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("cycling_profiles", "power_model_fitted_at")
    op.drop_column("cycling_profiles", "atl_tau")
    op.drop_column("cycling_profiles", "ctl_tau")
    op.drop_column("cycling_profiles", "personalized_vo2max")
    op.drop_column("cycling_profiles", "power_model_r_squared")
    op.drop_column("cycling_profiles", "w_prime")
    op.drop_column("cycling_profiles", "critical_power")
