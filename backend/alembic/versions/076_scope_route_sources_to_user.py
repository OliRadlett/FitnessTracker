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

_USER_SCOPED_UC = "uq_route_source_provider_user"


def _unique_constraints(table: str) -> dict[str, tuple[str, ...]]:
    """Map each UNIQUE constraint on ``table`` to its ordered column list.

    005 created the legacy constraint as a bare ``UNIQUE (provider,
    provider_route_id)`` inside ``CREATE TABLE``, so PostgreSQL auto-named it
    ``route_sources_provider_provider_route_id_key``. Databases created by
    ``Base.metadata.create_all()`` instead carry the name this migration
    assumed. Reading the real names is the only way to handle both.
    """
    rows = op.get_bind().execute(
        sa.text(
            """
            SELECT c.conname,
                   ARRAY(
                       SELECT a.attname
                       FROM unnest(c.conkey) AS k
                       JOIN pg_attribute a
                         ON a.attrelid = c.conrelid AND a.attnum = k
                       ORDER BY k
                   )
            FROM pg_constraint c
            WHERE c.conrelid = to_regclass(:table) AND c.contype = 'u'
            """
        ),
        {"table": table},
    ).all()
    return {name: tuple(cols) for name, cols in rows}


def _legacy_global_unique_names(
    constraints: dict[str, tuple[str, ...]],
) -> list[str]:
    """Names of the global ``(provider, provider_route_id)`` constraints.

    Pure so the regression stays testable: the constraint may be called
    ``uq_route_source_provider`` (create_all databases) or
    ``route_sources_provider_provider_route_id_key`` (migration-built
    databases), and dropping a hard-coded name only works for the first.
    """
    return [
        name
        for name, cols in constraints.items()
        if name != _USER_SCOPED_UC and set(cols) == {"provider", "provider_route_id"}
    ]


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
    # Drop whichever global (provider, provider_route_id) constraint exists
    # under whichever name it was created with.
    for name in _legacy_global_unique_names(_unique_constraints("route_sources")):
        op.drop_constraint(name, "route_sources", type_="unique")
    if _USER_SCOPED_UC not in _unique_constraints("route_sources"):
        op.create_unique_constraint(
            _USER_SCOPED_UC,
            "route_sources",
            ["provider", "provider_route_id", "user_id"],
        )


def downgrade() -> None:
    if _USER_SCOPED_UC in _unique_constraints("route_sources"):
        op.drop_constraint(_USER_SCOPED_UC, "route_sources", type_="unique")
    op.create_unique_constraint(
        "uq_route_source_provider",
        "route_sources",
        ["provider", "provider_route_id"],
    )
    op.drop_constraint(
        "fk_route_sources_user_id", "route_sources", type_="foreignkey"
    )
    op.drop_column("route_sources", "user_id")
