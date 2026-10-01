"""Undo claim: one compensation record per destructive operation (plan §8).

Not a soft delete and not a trash can. See ``services/undo.py`` for why, and for
the three classes of destructive operation -- only the class with out-of-band
effects (a merge that trains the embedding metric, a PR notification that is
*pushed to a device*) earns a row here.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UndoLog(Base):
    """A snapshot of a completed destructive operation, plus how to reverse it.

    ``payload`` is the operation's snapshot and its shape is **kind-specific**.
    Nothing at the database level validates it; restore logic is typed per kind
    and registered in ``services/undo.RESTORERS``, and :func:`record_undo`
    refuses a kind with no registered restorer. That split is deliberate -- a
    single table with an enforced payload schema would need a migration per
    operation, and an unvalidated one with typed restorers needs neither.

    ``merged_route_id`` in ``RouteMergeLog`` is a good precedent for why the
    payload holds ids rather than embedded rows: the rows a restore needs may be
    gone by the time it runs, and plan §3.5 requires the restorer to re-validate
    each parent anyway.
    """

    __tablename__ = "undo_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Which operation wrote this record. The restorer is looked up by this
    # string, so it is an enum in all but name -- kept as a string so adding a
    # kind is a code change plus one row, not a migration.
    kind: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # Replay guard. NULL = still undoable. Must be claimed by a conditional
    # UPDATE *before* the restore runs, or two concurrent undos both restore.
    undone_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Retention. After this instant the operation is no longer undoable.
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (Index("ix_undo_logs_user_id_kind", "user_id", "kind"),)