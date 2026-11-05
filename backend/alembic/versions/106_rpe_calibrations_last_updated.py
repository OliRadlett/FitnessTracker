"""Align rpe_calibrations timestamp with the model (last_updated).

The table was created by ``create_all`` before migration 052 existed and later
stamped, so production has ``updated_at`` while the model and
``video_analytics`` write ``last_updated``. The export then died with
``UndefinedColumnError`` (and the 250 MB backend also lacked the headroom for
all streams). Rename the column forward; a fresh database already has the
model's name, so the migration is a no-op there.

Revision ID: 106
Revises: 105
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "106"
down_revision = "105"
branch_labels = None
depends_on = None


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("rpe_calibrations")}


def upgrade() -> None:
    columns = _columns()
    if "updated_at" in columns and "last_updated" not in columns:
        op.alter_column(
            "rpe_calibrations",
            "updated_at",
            new_column_name="last_updated",
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=True,
        )
    elif "last_updated" not in columns:
        op.add_column(
            "rpe_calibrations",
            sa.Column("last_updated", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    columns = _columns()
    if "last_updated" in columns and "updated_at" not in columns:
        op.alter_column(
            "rpe_calibrations",
            "last_updated",
            new_column_name="updated_at",
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=True,
        )
