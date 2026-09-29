"""Delete legacy standalone Wahoo non-ride activities.

Revision ID: 085
Revises: 084
Create Date: 2026-09-29

A 2026-08-17 backfill (an older ingest that created rows instead of merging)
inserted 130 standalone ``source='wahoo'`` activities. The current
``sync_wahoo_activities`` is enrich-only (Strava is the source of truth), so
these can never be produced again. 121 of them are **not rides** — walks/golf/
surf/hike/workout rows stored with ``sport_type='cycling'`` because the sync read
an absent ``workout_type`` field (now fixed to read ``workout_type_id``).

They are informationally inert (no distance, no streams, no route, no TSS) but
poison "cycling" denominators and — via ``conformity.py`` sport matching — could
be linked to a planned cycle day and marked complete.

This migration backs the affected rows up, then deletes the 121 non-ride rows
(``workout_type_id != 0``), keeping the 9 bike-typed rows.
``activity_sources`` cascades; nothing else references them (verified: 0 streams,
0 segment efforts, 0 plan days, 0 lifting sessions, 0 power records).
"""

import sqlalchemy as sa

from alembic import op

revision = "085"
down_revision = "084"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Back up matching activities + their sources (created once, idempotent).
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS _wahoo_legacy_backup AS
            SELECT * FROM activities WHERE false
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS _wahoo_legacy_sources_backup AS
            SELECT * FROM activity_sources WHERE false
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO _wahoo_legacy_backup
            SELECT * FROM activities
            WHERE source = 'wahoo'
              AND coalesce(raw_data->>'workout_type_id', '') <> ''
              AND (raw_data->>'workout_type_id') <> '0'
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO _wahoo_legacy_sources_backup
            SELECT s.* FROM activity_sources s
            JOIN activities a ON a.id = s.activity_id
            WHERE a.source = 'wahoo'
              AND coalesce(a.raw_data->>'workout_type_id', '') <> ''
              AND (a.raw_data->>'workout_type_id') <> '0'
            """
        )
    )

    # 2. Delete the non-ride rows (activity_sources cascades).
    op.execute(
        sa.text(
            """
            DELETE FROM activities
            WHERE source = 'wahoo'
              AND coalesce(raw_data->>'workout_type_id', '') <> ''
              AND (raw_data->>'workout_type_id') <> '0'
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO activities
            SELECT * FROM _wahoo_legacy_backup
            ON CONFLICT (id) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO activity_sources
            SELECT * FROM _wahoo_legacy_sources_backup
            ON CONFLICT (id) DO NOTHING
            """
        )
    )
    # Backup tables are intentionally retained so the restore is repeatable.
