"""Scope route_sources to the owning user.

The old ``uq_route_source_provider`` unique constraint on
(provider, provider_route_id) was global: when a second user imported the
same provider tour (e.g. a public Komoot route), the lookup found the first
user's RouteSource and attached them to the first user's Route
(cross-user exposure). Sources now carry ``user_id`` (backfilled from the
parent route) with uniqueness on (provider, provider_route_id, user_id), so
each user owns a distinct Route for the same provider tour.

Revision ID: 076
Revises: 075
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision = "076"
down_revision = "075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "route_sources",
        sa.Column("user_id", PG_UUID(as_uuid=True), nullable=True),
    )
    # Backfill from the parent route's owner (every source belongs to a route).
    op.execute(
        "UPDATE route_sources SET user_id = routes.user_id "
        "FROM routes WHERE route_sources.route_id = routes.id"
    )
    op.alter_column(
        "route_sources",
        "user_id",
        existing_type=PG_UUID(as_uuid=True),
        nullable=False,
    )
    op.create_foreign_key(
        "fk_route_sources_user_id",
        "route_sources",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_constraint("uq_route_source_provider", "route_sources", type_="unique")
    op.create_unique_constraint(
        "uq_route_source_provider_user",
        "route_sources",
        ["provider", "provider_route_id", "user_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_route_source_provider_user", "route_sources", type_="unique"
    )
    op.create_unique_constraint(
        "uq_route_source_provider",
        "route_sources",
        ["provider", "provider_route_id"],
    )
    op.drop_constraint(
        "fk_route_sources_user_id", "route_sources", type_="foreignkey"
    )
    op.drop_column("route_sources", "user_id")
