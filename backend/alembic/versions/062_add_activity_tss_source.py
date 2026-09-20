"""add activities.tss_source + conservative backfill (QW4 TSS provenance)

Revision ID: 062
Revises: 061
Create Date: 2026-09-20

Adds a nullable ``activities.tss_source`` column ('power' | 'hr' | 'provider'
| 'manual') so the UI can badge power-TSS vs hrTSS instead of showing one
indistinguishable load number.

Backfill heuristic (conservative — only labels rows where the evidence is
unambiguous, else leaves NULL for "unknown"):

1. Rows with power data (normalized_power or average_power) AND a
   power-stream row (stream_type 'watts' from Strava or 'power' from FIT
   import) → 'power'. The stream requirement mirrors the auto-compute
   power-first priority: a power-capable ride with FTP set would have taken
   the power branch.
2. Remaining rows with average_heartrate → 'hr' (the only other in-app
   computation that writes TSS).
3. Everything else stays NULL. Deliberately NOT 'provider': no current sync
   path ingests provider-supplied TSS (Strava/Wahoo/FIT summaries carry no
   TSS field), so attributing unexplained TSS to a provider would fabricate
   provenance. 'provider'/'manual' apply going forward only.

Mirrors ``app.services.cycling.tss.infer_tss_source`` (same rules in Python
for unit tests); the SQL below is the set-based equivalent.
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "062"
down_revision = "061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("tss_source", sa.String(10), nullable=True))

    # 1. Power-computed: power data + FTP-era power-stream evidence.
    op.execute(
        sa.text(
            """
            UPDATE activities
            SET tss_source = 'power'
            WHERE tss IS NOT NULL
              AND tss_source IS NULL
              AND (normalized_power IS NOT NULL OR average_power IS NOT NULL)
              AND EXISTS (
                  SELECT 1 FROM activity_streams s
                  WHERE s.activity_id = activities.id
                    AND s.stream_type IN ('watts', 'power')
              )
            """
        )
    )

    # 2. hrTSS fallback: remaining TSS rows with heart-rate evidence.
    op.execute(
        sa.text(
            """
            UPDATE activities
            SET tss_source = 'hr'
            WHERE tss IS NOT NULL
              AND tss_source IS NULL
              AND average_heartrate IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_column("activities", "tss_source")
