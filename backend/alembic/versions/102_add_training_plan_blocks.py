"""Add ``training_plan_blocks`` (C1 -- the stored block/phase model).

The load strip deliberately invented no phase names while no block model existed
(redesign plan §5.4): it showed weekly load, events, taper and today, and nothing
that claimed a structure the database did not hold. This table is where that
structure lives -- a named, dated range inside a plan, with an optional focus and
weekly TSS target. The strip then draws the user's own blocks instead of guessing
at "Base/Build/Peak".

``focus`` is a free string rather than an enum on purpose: the vocabulary
(base/build/peak/taper/recovery/race) is a UI suggestion, so a user whose coach
says "accumulation" can write that.

Additive and empty for existing plans -- no backfill, and a plan with no blocks
renders exactly as it does today.

Revision ID: 102
Revises: 101
Create Date: 2026-10-16
"""

import sqlalchemy as sa

from alembic import op

revision = "102"
down_revision = "101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "training_plan_blocks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("plan_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("focus", sa.String(30), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("target_tss_per_week", sa.Float(), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["plan_id"], ["training_plans.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # The only read pattern is "this plan's blocks, in date order".
    op.create_index("ix_training_plan_blocks_plan_id", "training_plan_blocks", ["plan_id"])


def downgrade() -> None:
    op.drop_index("ix_training_plan_blocks_plan_id", table_name="training_plan_blocks")
    op.drop_table("training_plan_blocks")
