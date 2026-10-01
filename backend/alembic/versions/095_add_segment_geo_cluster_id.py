"""Add ``segments.geo_cluster_id`` -- cross-route identity for a physical hill.

``Segment`` is unique on ``(route_id, start_dist_m, end_dist_m)`` and
``sync_route_segments`` is delete-and-recreate per route, so the same hill
ridden on three routes is three rows with three PRs and three ``times_ridden``
counts. The rider's actual best on that hill is invisible, and because the
``/segments`` page groups by route there is no place to show it.

This column is that identity. It is deliberately **separate** from the existing
``cluster_id``: ``_extract_segment_features`` builds its DBSCAN feature vector
from gradient / length / gain shape with **no coordinates**, so
``cluster_id = 3`` means "climbs that look statistically alike" -- a training
analogue, correct for the job ``_predict_segment_effort`` borrows efforts with,
and the wrong primitive for identity. Notably the scheduler already sends
``start_lat/lng/end_lat/lng`` to Modal and ``analyze_segments`` discards them.

Nullable and additive, so no backfill is needed for correctness: existing rows
read as NULL and the weekly intelligence task fills them on its next run. The
index is what makes the hill leaderboard a single lookup rather than a scan.

No JSONB here -- ``sa.UUID()`` is exported at SQLAlchemy top level, so the
pitfall-22 dialect trap does not apply. ``tests/test_migration_dialect_types.py``
still covers this revision.

Renumbered from ``094`` when ``main`` shipped its own ``092`` in flight; never
pushed or applied anywhere shared. See the note in
``093_add_lifting_set_order_index.py``.

Revision ID: 095
Revises: 094
Create Date: 2026-10-01
"""

import sqlalchemy as sa

from alembic import op

revision = "095"
down_revision = "094"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "segments",
        sa.Column("geo_cluster_id", sa.UUID(), nullable=True),
    )
    op.create_index(
        "ix_segments_geo_cluster",
        "segments",
        ["geo_cluster_id"],
        # Not unique, and not partial: NULL is the legitimate "not clustered yet"
        # value and Postgres indexes those in a btree regardless, so a partial
        # index would only make the index smaller at the cost of a second code
        # path. Unlike the fingerprint column in 093 this key is a real member
        # id and NULL rows are transient.
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_segments_geo_cluster", table_name="segments")
    op.drop_column("segments", "geo_cluster_id")