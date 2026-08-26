"""Unique constraints for streams and Whoop workout enrichment.

- ``activity_streams(activity_id, stream_type)``: the weekly streams backfill
  and the manual backfill use different lock namespaces and could both insert
  a stream for the same activity/type — a unique constraint makes the loser
  fail instead of silently duplicating rows.
- ``lifting_sessions.whoop_workout_id`` (partial, where not null): the time-
  overlap match must attach a Whoop workout to at most one lifting session.

Revision ID: 036
Revises: 035
Create Date: 2026-08-26
"""

import sqlalchemy as sa

from alembic import op

revision = "036"
down_revision = "035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Dedupe existing duplicate streams (keep the earliest id) ──────────
    op.execute(
        """
        DELETE FROM activity_streams a
        USING activity_streams b
        WHERE a.activity_id = b.activity_id
          AND a.stream_type = b.stream_type
          AND a.id > b.id
        """
    )
    op.create_unique_constraint(
        "uq_activity_streams_activity_type",
        "activity_streams",
        ["activity_id", "stream_type"],
    )

    # ── Dedupe duplicate Whoop-workout attaches (keep the earliest session) ──
    op.execute(
        """
        UPDATE lifting_sessions ls
        SET whoop_workout_id = NULL
        WHERE ls.whoop_workout_id IS NOT NULL
          AND ls.id NOT IN (
              SELECT DISTINCT ON (whoop_workout_id) id
              FROM lifting_sessions
              WHERE whoop_workout_id IS NOT NULL
              ORDER BY whoop_workout_id, created_at, id
          )
        """
    )
    op.create_index(
        "uq_lifting_sessions_whoop_workout",
        "lifting_sessions",
        ["whoop_workout_id"],
        unique=True,
        postgresql_where=sa.text("whoop_workout_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_lifting_sessions_whoop_workout", table_name="lifting_sessions")
    op.drop_constraint("uq_activity_streams_activity_type", "activity_streams", type_="unique")