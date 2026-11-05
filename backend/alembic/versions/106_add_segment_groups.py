"""Add ``segment_groups`` and link segments/efforts to a stable group.

The current ``segments`` row is a per-route window. The same physical climb is
detected on several routes, and the only cross-route key is
``segments.geo_cluster_id`` — the lexicographically smallest member's UUID,
which moves whenever membership changes. That is fine for a display grouping
and wrong for an identity anything hangs off.

This migration adds the entity the page actually needs: one row per
physical/defined segment, with a stable ``id``, a ``kind`` (``climb`` today;
sprints/descents/custom later), the user-owned ``display_name``, and the
canonical line's profile/metrics. ``segments`` becomes the *line* table.

Deliberately additive: ``group_id`` is nullable, nothing is dropped, and a
reader that ignores the new columns behaves exactly as before. The backfill is
a separate service call, so deploying the migration does not write 77 groups on
a production database inside an alembic transaction.

``segment_efforts.assisted`` is nullable (true / false / unknown). Ranking
requires ``false``; the backfill leaves historical rows NULL until classified.

Revision ID: 106
Revises: 105
Create Date: 2026-11-05
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "106"
down_revision: str | Sequence[str] | None = "105"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "segment_groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("canonical_name", sa.String(200), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=True),
        sa.Column("name_source", sa.String(20), nullable=False),
        sa.Column("area", sa.String(120), nullable=True),
        sa.Column("region", sa.String(120), nullable=True),
        sa.Column("country", sa.String(120), nullable=True),
        sa.Column("centroid_lat", sa.Float(), nullable=True),
        sa.Column("centroid_lng", sa.Float(), nullable=True),
        sa.Column("distance_m", sa.Float(), nullable=False),
        sa.Column("gain_m", sa.Float(), nullable=False),
        sa.Column("avg_gradient_pct", sa.Float(), nullable=False),
        sa.Column("max_gradient_pct", sa.Float(), nullable=False),
        sa.Column("steepest_200m_pct", sa.Float(), nullable=False),
        sa.Column("sustained_share", sa.Float(), nullable=False),
        sa.Column("profile", postgresql.JSONB(), nullable=True),
        sa.Column("geometry", postgresql.JSONB(), nullable=True),
        sa.Column("category", sa.String(10), nullable=True),
        sa.Column("difficulty", sa.Float(), nullable=True),
        sa.Column("identity_key", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "kind",
            "identity_key",
            name="uq_segment_groups_user_kind_identity",
        ),
    )
    op.create_index("ix_segment_groups_user_id", "segment_groups", ["user_id"])
    op.create_index("ix_segment_groups_identity_key", "segment_groups", ["identity_key"])

    op.add_column(
        "segments",
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_segments_group_id_segment_groups",
        "segments",
        "segment_groups",
        ["group_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_segments_group_id", "segments", ["group_id"])

    op.add_column(
        "segment_efforts",
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "segment_efforts",
        sa.Column("moving_seconds", sa.Float(), nullable=True),
    )
    op.add_column(
        "segment_efforts",
        sa.Column("assisted", sa.Boolean(), nullable=True),
    )
    op.create_foreign_key(
        "fk_segment_efforts_group_id_segment_groups",
        "segment_efforts",
        "segment_groups",
        ["group_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_segment_efforts_group_id", "segment_efforts", ["group_id"])


def downgrade() -> None:
    op.drop_index("ix_segment_efforts_group_id", table_name="segment_efforts")
    op.drop_constraint(
        "fk_segment_efforts_group_id_segment_groups",
        "segment_efforts",
        type_="foreignkey",
    )
    op.drop_column("segment_efforts", "assisted")
    op.drop_column("segment_efforts", "moving_seconds")
    op.drop_column("segment_efforts", "group_id")

    op.drop_index("ix_segments_group_id", table_name="segments")
    op.drop_constraint(
        "fk_segments_group_id_segment_groups", "segments", type_="foreignkey"
    )
    op.drop_column("segments", "group_id")

    op.drop_index("ix_segment_groups_identity_key", table_name="segment_groups")
    op.drop_index("ix_segment_groups_user_id", table_name="segment_groups")
    op.drop_table("segment_groups")
