"""Add ``UndoLog`` -- one cross-cutting compensation record for destructive ops.

Not a trash can, and not a soft delete. Grep across ``app`` for
``deleted_at`` / ``is_deleted`` / ``soft_delete`` finds no such infrastructure,
so "undo" here means *compensating an operation's out-of-band effects* -- and
only class-3 operations (those that announce or train something outside their own
rows) have any worth compensating.

Why a table at all, given ``route_merge_log`` already is one? Because the one
genuinely cross-cutting policy is **how long a destructive operation stays
undoable**. Without one place to put it, every future undo invents its own
retention rule, and the next thing to break is a stale undo silently
restoring something the world has moved on from.

``payload`` is the operation's snapshot -- the same role as
``RouteMergeLog.snapshot`` + ``.moved``. It is JSONB and unvalidated at the
database level by design: restore logic is **typed per kind** and registered in
``services/undo.py``'s ``RESTORERS`` dispatch, so a kind with no registered
restorer is *rejected* rather than silently ignored. A single table must not
become a hole where each kind's restore is untyped string manipulation against a
payload whose shape nothing enforces.

``undone_at`` is the replay guard. ``undone_at`` must be claimed by a
conditional ``UPDATE ... WHERE undone_at IS NULL`` **before** the restore runs
(claim-after means two concurrent undos both restore).

Revision ID: 096
Revises: 095
Create Date: 2026-10-01
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "096"
down_revision = "095"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "undo_logs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        # Which operation wrote this record. The restorer is looked up by this
        # string, so it is an enum in all but name -- kept as a string so adding
        # a kind is a code change plus one row, not a migration.
        sa.Column("kind", sa.String(50), nullable=False),
        # postgresql.JSONB() with the explicit dialect import. `sa.JSONB()` does
        # not exist -- it is not exported at SQLAlchemy top level (pitfall 22).
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        # Replay guard. NULL = still undoable.
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
        # Retention. After this instant the operation is no longer undoable and
        # the row is audit data only.
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # The read pattern is "this user's live undo claims, newest first", and the
    # prune task is "everything past expires_at". One index serves both; a
    # partial index on undone_at IS NULL would shrink it but then the prune
    # cannot use it, and the table is small by construction (30-day retention).
    op.create_index("ix_undo_logs_user_id", "undo_logs", ["user_id"])
    op.create_index("ix_undo_logs_expires_at", "undo_logs", ["expires_at"])
    op.create_index("ix_undo_logs_user_id_kind", "undo_logs", ["user_id", "kind"])


def downgrade() -> None:
    op.drop_index("ix_undo_logs_user_id_kind", table_name="undo_logs")
    op.drop_index("ix_undo_logs_expires_at", table_name="undo_logs")
    op.drop_index("ix_undo_logs_user_id", table_name="undo_logs")
    op.drop_table("undo_logs")