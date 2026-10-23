"""Wahoo zone-set bookkeeping — what we wrote, and what was there before.

Wahoo's own model is **one zone set per sport profile**, and a set is an *anchor
plus derived boundaries* (FTP for power, THR for heart rate — see
``plans/wahoo-zone-sync.md`` §3.3). So the row that tracks our writes is keyed by
the same shape — ``(user, zone kind, workout-type family, location)`` — rather
than living as a handful of columns on ``CyclingProfile``, where indoor and
outdoor cycling could not both be tracked.

Two things about this table are load-bearing:

* ``boundaries`` / ``prior`` hold numbers and strings only, and are declared
  ``JSONB(none_as_null=True)`` because ``revert`` **clears** ``prior``. Without the
  flag the cleared value is the JSON literal ``null``, the row still matches
  ``IS NOT NULL``, and "has a snapshot" becomes permanently true (AGENTS.md
  pitfall 28 — migration 092 repaired exactly this mistake).
* ``prior`` is a snapshot taken before **our first** write and never overwritten.
  Otherwise revert means "undo the last of N pushes", which is not what the button
  says it does.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WahooZoneSet(Base):
    """One (user, zone kind, sport family, location) zone set we have written to."""

    __tablename__ = "wahoo_zone_sets"
    __table_args__ = (
        # One row per tracked set: the write path looks a row up by this key, so
        # without the constraint two concurrent pushes could both create one and
        # the second would silently own a set the first still references.
        UniqueConstraint(
            "user_id",
            "zone_kind",
            "workout_type_family_id",
            "workout_type_location_id",
            name="uq_wahoo_zone_sets_user_kind_set",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # "power" today; "heart_rate" is reserved — there is no documented Wahoo
    # endpoint for it, so nothing writes that value until that changes (§3.2).
    zone_kind: Mapped[str] = mapped_column(String(12), nullable=False)
    workout_type_family_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # 0 indoor / 1 outdoor / 255 unknown, per Wahoo's Workout Type Locations.
    workout_type_location_id: Mapped[int] = mapped_column(Integer, nullable=False)

    # Wahoo's own id, returned by create. NULL until the first successful push.
    wahoo_zone_set_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The anchor we last wrote (FTP today, THR if ever). Kept separately from the
    # local profile value so "the athlete changed it in the Wahoo app" is
    # detectable rather than invisible.
    anchor_value: Mapped[float | None] = mapped_column(nullable=True)
    boundaries: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    prior: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    pushed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Last non-auth failure, surfaced in the UI. Auth failures surface through
    # OAuthConnection health instead, so this stays bounded and short.
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
