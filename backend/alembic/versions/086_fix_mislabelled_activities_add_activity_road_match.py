"""Reclassify mislabelled activities + add road_match columns to activities.

Revision ID: 086
Revises: 085
Create Date: 2026-09-29

Part A — Activity road-match columns:
  Adds ``road_match``, ``road_embedding``, ``road_match_version`` to the
  ``activities`` table, mirroring the Route model. These store the OSM
  road-graph edge set (with coverage, names, version) so rides get the same
  "same-roads" signal that routes already have — the foundation for
  section-repeat / lap detection.

Part B — Reclassify mislabelled sport_type:
  A 2026-08-17 Wahoo backfill created 130 standalone activities, defaulting
  every workout's sport_type to "cycling" (the old code read an absent
  string ``workout_type`` instead of the integer ``workout_type_id``).
  Migration 085 purged 121 of them (those still ``source='wahoo'`` and with
  ``workout_type_id != 0``). But 28 rows had **already been merged** with
  their Strava source, which flipped ``activities.source`` to 'strava' — so
  migration 085's ``source = 'wahoo'`` predicate missed them.

  The 26 weight-training rows and 2 mis-tagged walk rows now sit as
  ``sport_type='cycling'`` despite being strength/walking sessions, with no
  same-day duplicate to lose. They poison cycling denominators and could be
  linked to planned cycle days (the ``source != 'wahoo'`` conformity guard
  doesn't catch them since their ``source`` is now 'strava').

  Fix has two steps:
  1. Wahoo-type mapping: reclassify by ``raw_data->>'workout_type_id'`` —
     same mapping as ``app.services.wahoo._WAHOO_WORKOUT_TYPE_ID_MAP``.
  2. Strava-source fallback: for any row still mislabelled after step 1
     (e.g. an unmapped Wahoo type, or NULL workout_type_id), reclassify
     from the Strava source's ``sport_type`` field. This catches the 2
     "Walk" rows even if their Wahoo type_id didn't map to walking.

  Both steps use the provenance predicate (has a wahoo source row) rather
  than ``activities.source = 'wahoo'`` — the gap that let migration 085
  miss them.

  The ``merge_activity`` sport_type reconciliation (added in this same
  deployment) prevents recurrence: when a higher-priority provider (Strava)
  merges into an activity created by a lower-priority provider (Wahoo), the
  sport_type is now corrected.
"""

import sqlalchemy as sa

from alembic import op

revision = "086"
down_revision = "085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Part A: road_match columns on activities ─────────────────────────────
    op.add_column("activities", sa.Column("road_match", sa.JSONB(), nullable=True))
    op.add_column("activities", sa.Column("road_embedding", sa.JSONB(), nullable=True))
    op.add_column(
        "activities", sa.Column("road_match_version", sa.Integer(), nullable=True)
    )

    # ── Part B: reclassify mislabelled activities ────────────────────────────
    # Provenance predicate: has a wahoo source row in activity_sources.
    # Migration 085's `source = 'wahoo'` check missed these because merge with
    # Strava already flipped activities.source to 'strava'.

    # Step 1 — reclassify by Wahoo workout_type_id (same mapping as wahoo.py).
    # Cycling IDs (0, 11-17, 49, 61, 64, 68, 70) are not in any CASE branch,
    # so they stay 'cycling' (correct).
    op.execute(
        sa.text(
            """
            UPDATE activities
            SET sport_type = CASE
                WHEN raw_data->>'workout_type_id' IN ('1','3','4','5','67','71') THEN 'running'
                WHEN raw_data->>'workout_type_id' IN ('6','7','8','56') THEN 'walking'
                WHEN raw_data->>'workout_type_id' IN ('9','10') THEN 'hiking'
                WHEN raw_data->>'workout_type_id' IN ('25','26') THEN 'swimming'
                WHEN raw_data->>'workout_type_id' IN ('20','22','42','43','44','66','69') THEN 'strength'
                WHEN raw_data->>'workout_type_id' = '46' THEN 'golf'
                ELSE sport_type
            END
            WHERE sport_type = 'cycling'
              AND (raw_data->>'workout_type_id') IS NOT NULL
              AND (raw_data->>'workout_type_id')::int <> 0
              AND EXISTS (
                  SELECT 1 FROM activity_sources s
                  WHERE s.activity_id = activities.id
                    AND s.provider = 'wahoo'
              )
            """
        )
    )

    # Step 2 — fallback: reclassify from Strava source sport_type for any row
    # still mislabelled after step 1. This catches edge cases where the Wahoo
    # type_id didn't map (e.g. NULL or unknown type), which is how the 2
    # mis-tagged "Walk" rows could survive if their Wahoo type_id is unmapped.
    op.execute(
        sa.text(
            """
            UPDATE activities
            SET sport_type = CASE s_strava.sport_type
                WHEN 'Walk' THEN 'walking'
                WHEN 'WeightTraining' THEN 'strength'
                WHEN 'StrengthTraining' THEN 'strength'
                WHEN 'Powerlifting' THEN 'strength'
                WHEN 'CrossFit' THEN 'strength'
                WHEN 'Workout' THEN 'strength'
                WHEN 'Run' THEN 'running'
                WHEN 'TrailRun' THEN 'running'
                WHEN 'VirtualRun' THEN 'running'
                WHEN 'Hike' THEN 'hiking'
                WHEN 'Swim' THEN 'swimming'
                WHEN 'Golf' THEN 'golf'
                ELSE activities.sport_type
            END
            FROM (
                SELECT a2.id, s2.raw_data->>'sport_type' AS sport_type
                FROM activities a2
                JOIN activity_sources s2 ON s2.activity_id = a2.id
                WHERE s2.provider = 'strava'
                  AND s2.raw_data->>'sport_type' IN (
                      'Walk','WeightTraining','StrengthTraining','Powerlifting',
                      'CrossFit','Workout','Run','TrailRun','VirtualRun',
                      'Hike','Swim','Golf'
                  )
            ) s_strava
            WHERE activities.id = s_strava.id
              AND activities.sport_type = 'cycling'
              AND EXISTS (
                  SELECT 1 FROM activity_sources s
                  WHERE s.activity_id = activities.id
                    AND s.provider = 'wahoo'
              )
            """
        )
    )


def downgrade() -> None:
    # Part B rollback: all 28 rows were 'cycling' before Part A ran.
    op.execute(
        sa.text(
            """
            UPDATE activities
            SET sport_type = 'cycling'
            WHERE EXISTS (
                SELECT 1 FROM activity_sources s
                WHERE s.activity_id = activities.id
                  AND s.provider = 'wahoo'
            )
            AND (raw_data->>'workout_type_id') IS NOT NULL
            AND (raw_data->>'workout_type_id')::int <> 0
            """
        )
    )

    # Part A rollback
    op.drop_column("activities", "road_match_version")
    op.drop_column("activities", "road_embedding")
    op.drop_column("activities", "road_match")
