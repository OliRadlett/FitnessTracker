"""Deduplicate cross_domain_insights and enforce one row per (user, type).

RMI-08: the weekly scheduler (``analyze_cross_domain_weekly``) did a blind
``db.add()`` for ``sleep_performance`` and ``cross_sport``, so every weekly run
appended a new row per qualifying user with no dedup. Growth was linear in
weeks and unbounded; only the API's latest-per-type read path masked it, while
``data_export`` surfaced the duplicates verbatim.

This migration (1) collapses existing duplicate ``(user_id, insight_type)``
rows to the newest, then (2) replaces migration 059's *non-unique* index with a
UNIQUE constraint. That constraint is the on_conflict target for the scheduler
upsert and blocks the blind-insert path at the DB layer.

Captain's decision (Option A): the constraint covers ALL three insight types,
so ``race_retrospective`` becomes latest-only too. This is consistent with every
current reader — ``api/cross_domain.py`` and ``services/today.py`` both consume
only the latest per type — and the migration keeps the newest row per type while
dropping older retrospectives.

Pitfall 22: only portable ``sa.*`` types are used here; the JSONB columns this
table owns were created by migration 059 and are left untouched.

Revision ID: 097
Revises: 096
Create Date: 2026-10-02
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "097"
down_revision = "096"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Collapse duplicate (user_id, insight_type) rows — keep the newest by
    #    (created_at DESC, id DESC), delete the rest. The nested subquery is the
    #    standard Postgres idiom: the outer DELETE cannot reference a window
    #    function directly, and must not select from the table it deletes. This
    #    runs *before* adding the constraint, because the unique index cannot be
    #    built over duplicate pairs.
    op.execute(
        sa.text(
            """
            DELETE FROM cross_domain_insights
            WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY user_id, insight_type
                               ORDER BY created_at DESC, id DESC
                           ) AS rn
                    FROM cross_domain_insights
                ) ranked
                WHERE ranked.rn = 1
            )
            """
        )
    )

    # 2. 059 created a *non-unique* index for (user_id, insight_type) lookups.
    #    Drop it and replace it with a UNIQUE CONSTRAINT: its implicit index
    #    serves the same lookups, and it is a hard guarantee that the upsert's
    #    ON CONFLICT (user_id, insight_type) can rely on.
    op.drop_index(
        "ix_cross_domain_insights_user_type",
        table_name="cross_domain_insights",
    )
    op.create_unique_constraint(
        "uq_cross_domain_insight_user_type",
        "cross_domain_insights",
        ["user_id", "insight_type"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_cross_domain_insight_user_type",
        "cross_domain_insights",
        type_="unique",
    )
    op.create_index(
        "ix_cross_domain_insights_user_type",
        "cross_domain_insights",
        ["user_id", "insight_type"],
    )
