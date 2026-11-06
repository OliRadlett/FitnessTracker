"""Add ride -> route link trust to activities.

Revision ID: 118
Revises: 117

The existing ``activities.route_id`` links came from a work-in-progress
matcher; they are evidence, not ground truth. This migration keeps the links
but marks every existing one as ``suggested`` + ``legacy``. Course history,
PRs and "ridden" counts must read ``confirmed`` only.

No link is deleted, and no link is promoted to confirmed.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "118"
down_revision = "117"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activities",
        sa.Column("route_link_status", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "activities",
        sa.Column("route_link_source", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "activities", sa.Column("route_link_confidence", sa.Float(), nullable=True)
    )
    op.add_column(
        "activities",
        sa.Column("route_link_confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Existing links are suggestions, never confirmations. NULL status for
    # rows with no route is intentional; the check constraint below allows it.
    op.execute(
        """
        UPDATE activities
        SET route_link_status = 'suggested',
            route_link_source = 'legacy'
        WHERE route_id IS NOT NULL
        """
    )

    op.create_check_constraint(
        "ck_activity_route_link_status_requires_route",
        "activities",
        "route_link_status IS NULL OR route_id IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_activity_route_link_status_requires_route",
        "activities",
        type_="check",
    )
    op.drop_column("activities", "route_link_confirmed_at")
    op.drop_column("activities", "route_link_confidence")
    op.drop_column("activities", "route_link_source")
    op.drop_column("activities", "route_link_status")
