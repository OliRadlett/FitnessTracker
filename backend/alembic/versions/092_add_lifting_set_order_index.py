"""Add ``lifting_sets.order_index`` — explicit performance order per session.

The set order was implied by ``created_at``, which cannot express it. In
Postgres ``now()`` is the *transaction* timestamp, so every set inserted by a
single ``create_session`` call carries an identical value and the resulting
order is whatever the database happens to return. ``api/export.py:106``
worked around this by re-sorting alphabetically by ``exercise_name`` on
export — evidence the stored order was not trusted.

This is a prerequisite for two things the schema could not previously
express: reordering a session, and describing a superset (contiguous runs of
one exercise followed by another), both of which need a real ordering column.

Design notes:

* Nullable, so the column can be added without a blocking backfill on a live
  table. ``LiftingSession.sets`` orders by ``(order_index, created_at, id)``
  — the tiebreaks keep reads deterministic for rows that are still null.
* The backfill is a separate, idempotent statement ordered by
  ``(set_number, created_at, id)`` within ``(session_id, exercise_name)``.
  ``id`` is the final tiebreak so the order is *total*: re-running produces the
  same result rather than reshuffling. Guarded by ``WHERE order_index IS
  NULL`` so it cannot clobber writes made after the column was added.
* Additive ``Integer`` — no JSONB, so the dialect-import trap does not apply.

Revision ID: 092
Revises: 091
Create Date: 2026-10-01
"""

import sqlalchemy as sa

from alembic import op

revision = "092"
down_revision = "091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lifting_sets",
        sa.Column("order_index", sa.Integer(), nullable=True),
    )

    # Order each exercise's own sets first, then lay the exercises out end to
    # end by the position of their *first* set. Two stages because ordering the
    # session directly by per-exercise rank would interleave them (bench 1, row 1,
    # bench 2, row 2) instead of keeping each exercise contiguous.
    #
    # `id` appears as the final tiebreak at both stages, which makes the whole
    # ordering *total*: re-running yields the same assignment rather than
    # reshuffling. Guarded by `order_index IS NULL` throughout so it cannot
    # clobber rows written after the column was added.
    op.execute(
        """
        WITH within_exercise AS (
            SELECT
                id,
                session_id,
                exercise_name,
                created_at,
                row_number() OVER w AS rank_in_exercise
            FROM lifting_sets
            WHERE order_index IS NULL
            WINDOW w AS (
                PARTITION BY session_id, exercise_name
                ORDER BY set_number, created_at, id
            )
        ),
        exercise_start AS (
            -- Where each exercise begins, taken from its rank-1 set.
            SELECT
                session_id,
                exercise_name,
                created_at AS start_created_at,
                id AS start_id
            FROM within_exercise
            WHERE rank_in_exercise = 1
        )
        UPDATE lifting_sets AS ls
        SET order_index = laid_out.new_order
        FROM (
            SELECT
                we.id,
                row_number() OVER (
                    PARTITION BY we.session_id
                    ORDER BY
                        es.start_created_at,
                        es.start_id,
                        we.rank_in_exercise,
                        we.id
                ) - 1 AS new_order
            FROM within_exercise AS we
            JOIN exercise_start AS es
              ON es.session_id = we.session_id
             AND es.exercise_name = we.exercise_name
        ) AS laid_out
        WHERE ls.id = laid_out.id
          AND ls.order_index IS NULL
        """
    )

    # B-tree on (session_id, order_index) so the ordered read is index-backed
    # rather than sorting every set of a session on each fetch.
    op.create_index(
        "ix_lifting_sets_session_order",
        "lifting_sets",
        ["session_id", "order_index"],
    )


def downgrade() -> None:
    op.drop_index("ix_lifting_sets_session_order", table_name="lifting_sets")
    op.drop_column("lifting_sets", "order_index")
