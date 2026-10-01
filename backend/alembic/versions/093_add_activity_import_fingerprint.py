"""Add ``activities.import_fingerprint`` — exact-duplicate guard for file imports.

``import_fit`` creates ``Activity(source='manual', …)`` with no
``provider_activity_id`` and no ``connection_id``, so there was nothing to
deduplicate on. Uploading the same file twice produced two rows, and every
load-bearing aggregate then counted that ride twice. Fatal for any bulk
workflow.

This column holds a sha256 of the file bytes — content-derived, so unlike a
provider id it cannot be rewritten by a later sync (pitfall 21: key on
provenance, not a mutable field).

Nullable, and the unique index is **partial**: a plain
``unique(user_id, import_fingerprint)`` would collide across the thousands of
provider-synced and manually-entered rows that are ``NULL``. ``NULL`` never
equals ``NULL`` in a unique index, but that only holds for a *partial* index
over the non-null rows; a full unique index would also reject a second NULL
in some planners' index builds and, more importantly, express a constraint
that is not what we mean.

The fuzzy tier (same sport, start within +/-5 min, duration and distance
within 1%) needs no column — it queries the existing ones.

Revision ID: 093
Revises: 092
Create Date: 2026-10-01
"""

import sqlalchemy as sa

from alembic import op

revision = "093"
down_revision = "092"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activities",
        sa.Column("import_fingerprint", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "uq_activities_import_fingerprint",
        "activities",
        ["user_id", "import_fingerprint"],
        unique=True,
        # Partial: only rows that actually carry a fingerprint participate.
        # Written with sa.text so the predicate is one object rather than a
        # string that alembic would quote.
        postgresql_where=sa.text("import_fingerprint IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_activities_import_fingerprint", table_name="activities")
    op.drop_column("activities", "import_fingerprint")
