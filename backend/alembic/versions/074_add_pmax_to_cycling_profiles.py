"""Add cycling_profiles.p_max (Morton 3-param sprint ceiling).

Stores Pmax (watts) fitted by the weekly power-model task. The 3-param
model P(t) = W'/(t + k) + CP with k = W'/(Pmax - CP) stays bounded at
sprint durations, fixing the 3000W+ 5s spike the 2-param P(t) = W'/t + CP
extrapolation produced. Nullable: profiles fitted before this migration
keep CP/W' only and the API falls back to the 60s+ 2-param curve.

Revision ID: 074
Revises: 072
Create Date: 2026-09-24
"""

import sqlalchemy as sa

from alembic import op

revision = "074"
down_revision = "072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cycling_profiles",
        sa.Column("p_max", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cycling_profiles", "p_max")
