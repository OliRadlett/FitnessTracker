"""Add ``activities.power_provenance`` and backfill it from the stored payload.

Strava's activity summary says whether the power channel was measured
(``device_watts: true``) or estimated from heart rate and bodyweight
(``device_watts: false``). Nothing read that flag, so an estimated ride was
indistinguishable from a measured one downstream: it could hold an all-time
power PR, inflate W/kg, and underpin a power-derived TSS, each badged ``power``.

The value is already in the database — every synced Strava activity keeps its
full summary in ``activities.raw_data`` — so the backfill needs no API calls and
no re-sync. It runs here rather than in a Celery task because it is a one-shot
classification of rows that already exist: a task would have to be scheduled,
idempotent and observable, to write one UPDATE.

``AND average_power IS NOT NULL`` is load-bearing. Strava returns
``device_watts: false`` for activities that have no power channel at all (runs,
rides recorded without a meter or an estimate). Without the guard those rows
would be labelled ``estimated``, which claims the provider guessed a number it
never produced. With it, "has power but no meter" becomes ``estimated`` and
"has no power" stays NULL.

``IN ('true','false')`` rather than a cast: ``(raw_data->>'device_watts')::boolean``
raises on any unexpected text, and a migration that raises under transactional
DDL reverts itself (AGENTS.md pitfall 22). Comparing the JSON text cannot.

Rows are left NULL when the payload cannot answer — an older activity whose
payload predates the field, or a manual/non-Strava row. Everything downstream
fails open on NULL, so an unclassified row keeps whatever trust it had.

Revision ID: 107
Revises: 106
Create Date: 2026-11-05
"""

import sqlalchemy as sa

from alembic import op

revision = "107"
down_revision = "106"
branch_labels = None
depends_on = None

# Strava's activity summary stores the flag as a JSON boolean, so `->>` yields
# the text 'true' or 'false'.
_BACKFILL = """
UPDATE activities
SET power_provenance = CASE
        WHEN raw_data->>'device_watts' = 'true' THEN 'measured'
        ELSE 'estimated'
    END
WHERE source = 'strava'
  AND average_power IS NOT NULL
  AND raw_data->>'device_watts' IN ('true', 'false')
"""


def upgrade() -> None:
    op.add_column(
        "activities",
        sa.Column("power_provenance", sa.String(length=10), nullable=True),
    )
    op.execute(sa.text(_BACKFILL))


def downgrade() -> None:
    op.drop_column("activities", "power_provenance")
