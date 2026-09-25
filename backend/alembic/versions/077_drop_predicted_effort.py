"""Drop the unwritten routes.predicted_effort column.

The Modal kNN route-effort prediction path was never enabled
(``compute_effort_predictions=False`` in the only caller) and nothing ever
wrote this column, so every row is NULL. Route effort estimation is served
by the physics-based ``estimate_effort`` (FTP/weight) behind
``GET /routes/{id}/effort-estimate`` instead; the dead Modal branch is
removed alongside this column.

Revision ID: 077
Revises: 076
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "077"
down_revision = "076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("routes", "predicted_effort")


def downgrade() -> None:
    op.add_column(
        "routes",
        sa.Column("predicted_effort", JSONB(), nullable=True),
    )
