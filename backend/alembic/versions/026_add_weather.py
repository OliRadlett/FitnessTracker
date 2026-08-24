"""Add weather caching table and activity weather columns.

Revision ID: 026
Revises: 025
Create Date: 2026-08-24
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cached_weather",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column(
            "weather_type", sa.String(length=20), nullable=False
        ),  # current | forecast | historical
        sa.Column("weather_data", JSONB(), nullable=False),
        sa.Column(
            "cached_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("cycling_profiles", sa.Column("home_lat", sa.Float(), nullable=True))
    op.add_column("cycling_profiles", sa.Column("home_lng", sa.Float(), nullable=True))
    op.add_column(
        "activities",
        sa.Column("weather_temperature", sa.Float(), nullable=True),
    )
    op.add_column(
        "activities",
        sa.Column("weather_conditions", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "activities",
        sa.Column("weather_wind_speed_kmh", sa.Float(), nullable=True),
    )
    op.add_column(
        "activities",
        sa.Column("weather_wind_direction", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "activities",
        sa.Column("weather_precipitation_mm", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("activities", "weather_precipitation_mm")
    op.drop_column("activities", "weather_wind_direction")
    op.drop_column("activities", "weather_wind_speed_kmh")
    op.drop_column("activities", "weather_conditions")
    op.drop_column("activities", "weather_temperature")
    op.drop_column("cycling_profiles", "home_lng")
    op.drop_column("cycling_profiles", "home_lat")
    op.drop_table("cached_weather")
