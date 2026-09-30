"""Add ``routes.quarantined_at``.

67 of 108 routes carry zero linked activities — the surviving half of an
earlier merge, or a lap-variant twin that was absorbed and never cleaned
up. They sit in every candidate query, so a new activity can be matched
against a route nothing has ever been ridden on, and the similarity
metric trains negatives against rows that should not count.

A nullable timestamp, not a boolean: ``NULL`` means "never quarantined",
and the value is the audit of when the route was set aside. A boolean
could not tell "quarantined" from "quarantined and later restored", and
re-running the sweep would overwrite the original date.

This migration is deliberately inert — it adds the column and changes
nothing else. Deciding *which* routes are orphans is a data judgement, so
it belongs in an explicit, dry-run-first sweep
(``app.services.route_quarantine.quarantine_orphaned_routes``) rather than
being hidden inside a schema change where it would be invisible and
immediate. Nullable means every existing row starts as "not quarantined".

Revision ID: 089
Revises: 088
Create Date: 2026-09-30
"""

import sqlalchemy as sa

from alembic import op

revision = "089"
down_revision = "088"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "routes",
        sa.Column("quarantined_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("routes", "quarantined_at")
