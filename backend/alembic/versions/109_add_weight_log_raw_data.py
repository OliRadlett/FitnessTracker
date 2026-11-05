"""Add ``weight_logs.raw_data`` so a Withings weigh-in is stored whole.

The scale returns ~30 measurement types (heart pulse, pulse wave velocity,
vascular age, BMR, metabolic age, segmental masses, and more depending on the
model). ``_MEASTYPE_TO_FIELD`` maps eight of them to columns and
``group_measurements`` silently dropped the rest, so a reading the scale had
already computed was decoded and discarded — recoverable only by re-querying the
device's own history.

Every other provider keeps its payload (``activities.raw_data``,
``routes.raw_data``, ``activity_sources.raw_data``); Withings was the one
integration that threw it away. Storing the ``measuregrp`` verbatim makes
"which types does this scale actually send?" answerable from our own data, and
turns "map heart pulse properly" into a backfill instead of a re-sync.

Deliberately a plain ``JSONB``, not ``JSONB(none_as_null=True)``. That flag
exists for columns whose ``NULL`` is *load-bearing to a query* (road-match and
terrain columns, whose "clear" is read back as ``IS NULL``; AGENTS.md pitfall
28). This column is a document that is never cleared, and a JSON ``null`` inside
it legitimately means "the scale sent no value here", which must survive.

Revision ID: 109
Revises: 108
Create Date: 2026-11-05
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "109"
down_revision = "108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "weight_logs",
        sa.Column("raw_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("weight_logs", "raw_data")
