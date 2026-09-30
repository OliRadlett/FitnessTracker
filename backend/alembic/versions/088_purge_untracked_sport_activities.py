"""Purge activities whose sport is not tracked.

FitTrack tracks cycling and strength only, but Strava, Wahoo and Whoop all
map walks, hikes, golf, swimming and kayaking into ``Activity.sport_type``,
so 307 activities were sitting in the database: 291 walking/hiking, plus 7
golf, 7 swimming and 2 kayaking. Ingestion is now gated by
``ALLOWED_SPORT_TYPES`` (see ``app/services/sport_filter.py``), which stops
them coming back; this migration clears the existing rows.

The predicate below is a SQL literal on purpose. A migration must behave
identically on every replay, so it cannot read mutable config — if it did,
replaying 088 on a database with a different ``ALLOWED_SPORT_TYPES`` would
delete a different set of rows than the one that was recorded. **The literal
and the setting are deliberately coupled: change one, change the other.**

Safety
------
The doomed rows are copied to ``_purged_activities_088`` before the delete,
so the purge is recoverable. ``DELETE`` cascades to ``activity_sources`` and
``activity_streams``; the remaining referencing tables
(``lifting_sessions``, ``cycling_power_records``, ``training_plan_days``,
``llm_analyses``, ``ride_fuel_plans``, ``segment_efforts``) have no rows for
these sports, so no ``SET NULL`` path is exercised. ``downgrade`` restores
the activities from the backup, though the cascaded child rows are not
recoverable — use the backup table for a real restore.

Nothing else is affected: these activities carry no TSS, so CTL/ATL fitness
trends are unchanged, and none is linked to a route.

Revision ID: 088
Revises: 087
Create Date: 2026-09-30
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "088"
down_revision = "087"
branch_labels = None
depends_on = None

BACKUP_TABLE = "_purged_activities_088"

# Kept in sync with ALLOWED_SPORT_TYPES in app/config.py — see module docstring.
KEPT_SPORTS = ("cycling", "strength")


def upgrade() -> None:
    # KEPT_SPORTS is a module constant, not user input, so interpolating it
    # into the SQL is safe and keeps the statement readable in psql logs.
    kept = ", ".join(f"'{s}'" for s in KEPT_SPORTS)

    # Back up first, then delete. A SELECT * copy means a column added later
    # is captured without editing this migration.
    op.execute(
        sa.text(
            f"CREATE TABLE {BACKUP_TABLE} AS "
            f"SELECT * FROM activities "
            f"WHERE sport_type IS NULL OR sport_type NOT IN ({kept})"
        )
    )
    # CREATE TABLE AS copies columns but no constraints, so the backup has
    # no primary key. Restore relies on ON CONFLICT (id) DO NOTHING, which
    # needs a unique index to match against; without this the downgrade
    # would raise instead of skipping rows that already exist.
    op.execute(sa.text(f"ALTER TABLE {BACKUP_TABLE} ADD PRIMARY KEY (id)"))

    op.execute(
        sa.text(
            "DELETE FROM activities "
            f"WHERE sport_type IS NULL OR sport_type NOT IN ({kept})"
        )
    )


def downgrade() -> None:
    # Restore the activity rows from the backup. Child rows that cascaded
    # (activity_sources, activity_streams) are not restored.
    op.execute(
        sa.text(
            f"INSERT INTO activities SELECT * FROM {BACKUP_TABLE} "
            f"ON CONFLICT (id) DO NOTHING"
        )
    )
    op.execute(sa.text(f"DROP TABLE IF EXISTS {BACKUP_TABLE}"))
