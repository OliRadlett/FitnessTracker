"""Backfill Whoop respiratory rate from existing sleep payloads.

Whoop v2 returns respiratory rate on the sleep score
(``sleep_logs.raw_data.score.respiratory_rate``), not on recovery. The sync
only read it from recovery, so ``daily_metrics.respiratory_rate`` has always
been NULL even though every scored night carries a value.

This is a data-only migration: it copies the already-stored sleep value onto
the matching daily metric. No Whoop API calls, no schema change, and only rows
whose column is still NULL are touched.

Revision ID: 105
Revises: 104
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "105"
down_revision: str | Sequence[str] | None = "104"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ``#>>`` returns text; the regex guards a malformed/null payload before the
    # cast so one bad row cannot abort the whole migration.
    op.execute(
        sa.text(
            """
            UPDATE daily_metrics AS dm
            SET respiratory_rate =
                    (sl.raw_data #>> '{score,respiratory_rate}')::double precision,
                updated_at = now()
            FROM sleep_logs AS sl
            WHERE dm.user_id = sl.user_id
              AND dm.metric_date = sl.sleep_date
              AND dm.source = 'whoop'
              AND sl.source = 'whoop'
              AND dm.respiratory_rate IS NULL
              AND sl.raw_data #>> '{score,respiratory_rate}'
                  ~ '^[0-9]+(\\.[0-9]+)?$'
            """
        )
    )


def downgrade() -> None:
    # Data backfill only. Do not erase respiratory values on downgrade; a later
    # upgrade would have to recompute them from the sleep payloads again.
    pass
