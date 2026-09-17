"""Add weather-performance analysis fields to cycling_profiles.

Stores per-user weather coefficients, insights, and analysis timestamp
fitted by the weekly Modal weather analysis task.

Revision ID: 057
Revises: 056
Create Date: 2026-09-17
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "057"
down_revision = "056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cycling_profiles",
        sa.Column("weather_coefficients", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "cycling_profiles",
        sa.Column("weather_insights", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "cycling_profiles",
        sa.Column(
            "weather_analyzed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("cycling_profiles", "weather_analyzed_at")
    op.drop_column("cycling_profiles", "weather_insights")
    op.drop_column("cycling_profiles", "weather_coefficients")
