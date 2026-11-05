"""Add ``daily_metrics.spo2_percentage`` and ``skin_temp_celsius``.

Both values arrive in Whoop's *recovery* score, which the sync fetched one cycle
at a time and reduced to four fields (recovery, HRV, resting HR, respiratory
rate). Blood oxygen and sleeping skin temperature were in the same payload and
were discarded.

Why columns rather than leaving them in ``raw_data``: the sync stores a curated
``_recovery`` dict in ``DailyMetric.raw_data``, not the provider payload, so there
is nothing to backfill from — and both are read by the illness composite, which
queries columns. Existing rows stay NULL until the affected cycles are re-synced;
the nightly backfill only revisits rows whose ``recovery_score`` is NULL, so
historic days will not gain these values. That is acceptable for a signal whose
value is "what changed in the last week", and pretending otherwise would mean a
full re-fetch of every cycle for two optional fields.

No index: both are read inside a 7/30-day window that already uses the
``(user_id, metric_date)`` index.

Revision ID: 110
Revises: 109
Create Date: 2026-11-05
"""

import sqlalchemy as sa

from alembic import op

revision = "110"
down_revision = "109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daily_metrics",
        sa.Column("spo2_percentage", sa.Float(), nullable=True),
    )
    op.add_column(
        "daily_metrics",
        sa.Column("skin_temp_celsius", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daily_metrics", "skin_temp_celsius")
    op.drop_column("daily_metrics", "spo2_percentage")
