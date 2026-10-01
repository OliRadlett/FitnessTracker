"""Convert JSON ``null`` in cleared columns to real SQL ``NULL``.

``JSONB`` serialises a Python ``None`` as the JSON value ``null`` unless the
type is built with ``none_as_null=True``. Those are different things to
Postgres: a column holding JSON ``null`` is non-null, so ``IS NULL`` does not
match it.

The road-match and terrain columns are *cleared* — assigned ``None`` —
whenever a route's geometry changes, and the map-matching tasks select on
``WHERE road_match IS NULL`` to find work left to do. A cleared row was
therefore silently never re-matched. Nothing looked wrong: the attribute
reads back as ``None`` in Python either way, so the only way to see the
difference is to read the column back as raw SQL.

The model now declares these columns ``none_as_null=True``, which stops new
occurrences but cannot repair existing rows — hence this migration.

Production counts before the fix: ``routes.terrain_classification`` 21,
``routes.road_match`` 3, ``routes.road_embedding`` 3, and both Activity
columns 0. The Activity statements are no-ops today; they are included so
the invariant is enforced uniformly rather than by remembering which table
happened to be affected.

Scope is the five columns declared ``none_as_null=True`` in the models —
deliberately not all ~50 JSONB columns, since a column that legitimately
stores JSON null (a real "no value" inside a document) must keep doing so.

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

# (table, column) pairs matching the model declarations of none_as_null=True.
TARGETS = (
    ("routes", "road_match"),
    ("routes", "road_embedding"),
    ("routes", "terrain_classification"),
    ("activities", "road_match"),
    ("activities", "road_embedding"),
)


def upgrade() -> None:
    for table, column in TARGETS:
        op.execute(
            sa.text(
                f"UPDATE {table} SET {column} = NULL "  # fixed literals, not input
                f"WHERE {column} = 'null'::jsonb"
            )
        )


def downgrade() -> None:
    """Not reversible.

    JSON ``null`` and SQL ``NULL`` are indistinguishable in Python — the
    ORM reads both as ``None`` — so there is no way to tell which rows were
    converted. Restoring them would mean writing JSON null to *every* empty
    column in the table, which is the defect this migration removes.
    """
    raise NotImplementedError(
        "Converting JSON null to SQL NULL is not distinguishable in reverse; "
        "re-add a fresh column and re-derive the values if this must be undone."
    )
