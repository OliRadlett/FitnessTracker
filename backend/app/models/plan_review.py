"""Weekly plan-review snapshot (C3 — scheduled weekly review).

One row per weekly review of a plan. The review composes existing engines
(conformity, training load, adaptive, goals) into a snapshot, so "what changes
next week?" is computed once a week and stays readable — rather than recomputed
on every page load.

``payload`` shape is service-owned (same split as ``UndoLog.payload``): a
JSONB blob with typed producers/readers rather than a column per field, so
adding a section to the review is a code change, not a migration.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PlanReviewSnapshot(Base):
    """One persisted weekly review of a training plan (C3)."""

    __tablename__ = "plan_review_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("training_plans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Monday of the week the review covers — the idempotency key with plan_id.
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "plan_id", "week_start", name="uq_plan_review_snapshots_plan_week"
        ),
    )
