"""Classify route merges: identical vs variant.

Revision ID: 083
Revises: 082
Create Date: 2026-09-29

Adds ``route_merge_log.merge_kind`` so a merge can record *why* it was made:
``identical`` (the same route recorded twice — a valid duplicate) or ``variant``
(the same kind of ride, e.g. different lap counts of one circuit). Only
``identical`` merges are used to train the embedding metric; variants would
otherwise teach the matcher that distinct routes are duplicates.

Existing rows are backfilled to ``identical`` (the prior implicit assumption);
users can reclassify or reset them from the merge-history UI.
"""

import sqlalchemy as sa

from alembic import op

revision = "083"
down_revision = "082"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "route_merge_log",
        sa.Column("merge_kind", sa.String(length=20), nullable=True),
    )
    # Backfill: treats prior merges as duplicates unless reclassified. New rows
    # default to 'identical' at the application layer too.
    op.execute("UPDATE route_merge_log SET merge_kind = 'identical' WHERE merge_kind IS NULL")


def downgrade() -> None:
    op.drop_column("route_merge_log", "merge_kind")
