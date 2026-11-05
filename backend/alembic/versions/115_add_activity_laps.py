"""Add ``activities.laps`` — the provider's own lap boundaries.

Strava has always had laps (``GET /activities/{id}/laps``, and ``laps[]`` inside
the detail payload) and we have never asked for them, so the only intra-ride
structure available was ``pacing_analysis``'s ten equal-time slices. A 4x8 minute
session reads as ten arbitrary chunks under that scheme, and its
"power_variability" measures the slicing rather than the session.

A document, not a table: laps are read whole by one consumer, never queried or
joined, and the provider's shape drifts. Normalized on write so the consumer does
not learn Strava's field names.

Revision ID: 115
Revises: 114
Create Date: 2026-11-05
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "115"
down_revision = "114"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activities",
        sa.Column("laps", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("activities", "laps")
