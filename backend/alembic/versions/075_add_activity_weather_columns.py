"""Add humidity/pressure/wind-direction columns to activities.

Stores the Open-Meteo daily aggregates the Modal weather analysis needs as
real varying features: mean relative humidity (%), mean sea-level pressure
(hPa), and dominant wind direction (degrees). Previously humidity/pressure
were hardcoded None at tag time (constant 50/1013 placeholders → singular
regression columns) and wind direction was never stored, so wind-component
insights could never fire.

Revision ID: 075
Revises: 074
Create Date: 2026-09-25
"""

import sqlalchemy as sa

from alembic import op

revision = "075"
down_revision = "074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activities",
        sa.Column("weather_humidity_pct", sa.Float(), nullable=True),
    )
    op.add_column(
        "activities",
        sa.Column("weather_pressure_hpa", sa.Float(), nullable=True),
    )
    op.add_column(
        "activities",
        sa.Column("weather_wind_direction_deg", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("activities", "weather_wind_direction_deg")
    op.drop_column("activities", "weather_pressure_hpa")
    op.drop_column("activities", "weather_humidity_pct")
