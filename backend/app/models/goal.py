import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    metric: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        server_default="ftp_watts",
    )  # semantic metric key — see services/goal_metrics.py METRIC_REGISTRY
    filter_json: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True
    )  # e.g. {"exercise": "Back Squat"} or {"sport": "cycling"}
    starting_value: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )  # snapshot at creation for trajectory/direction derivation
    target_value: Mapped[float] = mapped_column(Float, nullable=False)
    current_value: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )  # cached latest resolved value
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", server_default="active"
    )  # active, achieved, expired, abandoned
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="goals")  # type: ignore[name-defined]
    check_ins: Mapped[list["GoalCheckIn"]] = relationship(
        back_populates="goal", cascade="all, delete-orphan"
    )


class GoalCheckIn(Base):
    """A point-in-time snapshot of a goal's metric value.

    Recorded automatically by the weekly Celery task (source="auto") or
    manually via the API (source="manual").  Powers trajectory charts and
    the alignment score history.
    """

    __tablename__ = "goal_checkins"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    goal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("goals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    check_in_date: Mapped[date] = mapped_column(Date, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    alignment_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="auto")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    goal: Mapped["Goal"] = relationship(back_populates="check_ins")
