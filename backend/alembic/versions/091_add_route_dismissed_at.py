"""Add ``routes.dismissed_at`` — the third state in orphan review.

``quarantined_at`` answers "is this route excluded from matching?". It
does not answer "has the user looked at it?". Without a separate stamp, a
route dismissed last week is indistinguishable from one never reviewed, so
the review queue never empties and the same wrong candidates are
re-proposed on every sweep.

Three states, and they are genuinely different:

  quarantined_at  dismissed_at   meaning
  ------------    -----------   ------------------------------------------------
  NULL            NULL           active route, never quarantined
  set             NULL           quarantined, awaiting the user's decision
  set             set            reviewed and rejected — hidden from the queue,
                                  but still quarantined

Kept separate (rather than overloading one column) so a dismissed route can
be restored later without losing the fact that it was judged and rejected.

Revision ID: 091
Revises: 090
Create Date: 2026-09-30
"""

import sqlalchemy as sa

from alembic import op

revision = "091"
down_revision = "090"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "routes",
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("routes", "dismissed_at")
