"""add nutrition actuals to ride_fuel_plans

Revision ID: 039
Revises: 038
Create Date: 2026-08-27
"""

import sqlalchemy as sa

from alembic import op

revision = "039"
down_revision = "038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ride_fuel_plans",
        sa.Column("actual_water_ml", sa.Float(), nullable=True),
    )
    op.add_column(
        "ride_fuel_plans",
        sa.Column("actual_carbs_g", sa.Float(), nullable=True),
    )
    op.add_column(
        "ride_fuel_plans",
        sa.Column("actual_electrolytes_mg", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ride_fuel_plans", "actual_electrolytes_mg")
    op.drop_column("ride_fuel_plans", "actual_carbs_g")
    op.drop_column("ride_fuel_plans", "actual_water_ml")
