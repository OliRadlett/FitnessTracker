"""Store the pre-taper plan state so unlink can restore it.

``link_event_and_apply_taper`` multiplied ``planned_tss`` in place with no
baseline. Unlinking left the shortened end date and tapered TSS behind, and a
later re-link tapered the already-tapered values again (0.4 -> 0.16).

These columns make the taper reversible and idempotent. They are additive and
nullable, so existing plans read exactly as before until they are linked.

Revision ID: 104
Revises: 103
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "104"
down_revision: str | Sequence[str] | None = "103"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "training_plans",
        sa.Column("taper_event_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_training_plans_taper_event_id_events",
        "training_plans",
        "events",
        ["taper_event_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "training_plans",
        sa.Column("pre_taper_end_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "training_plan_days",
        sa.Column("pre_taper_tss", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("training_plan_days", "pre_taper_tss")
    op.drop_column("training_plans", "pre_taper_end_date")
    op.drop_constraint(
        "fk_training_plans_taper_event_id_events",
        "training_plans",
        type_="foreignkey",
    )
    op.drop_column("training_plans", "taper_event_id")
