"""Add ``training_plans.strength_progression`` (S1 progression rules).

The plan's multi-week strength ramp (per-exercise mode, start targets, weekly
deltas, deload cadence and optional training max) had no home: it existed only
as a generation-time ``StrengthWeekTemplate`` that was written into days once
and then inert. This column is where the *rules* live, so ``materialise`` can
fill per-week cells and the user can edit them afterwards.

Nullable and additive — existing plans read as NULL, which means "no rules",
i.e. exactly today's stateless ``e1RM × %1RM`` behaviour. No backfill needed.

Dialect note: ``JSONB`` is imported from ``sqlalchemy.dialects.postgresql``,
never referenced as ``sa.JSONB()`` (AGENTS.md pitfall 22 — that name does not
exist on the top-level module, and the resulting ``AttributeError`` reverts
the *whole* migration under transactional DDL).

Revision ID: 099
Revises: 098
Create Date: 2026-10-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "099"
down_revision = "098"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # postgresql.JSONB() with the explicit dialect import — `sa.JSONB()` does
    # not exist (pitfall 22).
    op.add_column(
        "training_plans",
        sa.Column("strength_progression", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("training_plans", "strength_progression")
