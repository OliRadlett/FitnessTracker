import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TrainingPlan(Base):
    __tablename__ = "training_plans"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    plan_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="custom"
    )  # custom, build, base, peak, taper, recovery
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="draft"
    )  # draft, active, completed, archived
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("events.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="training_plans")  # type: ignore[name-defined]
    event: Mapped["Event | None"] = relationship()  # type: ignore[name-defined]
    days: Mapped[list["TrainingPlanDay"]] = relationship(
        back_populates="plan",
        cascade="all, delete-orphan",
        order_by="TrainingPlanDay.day_date",
    )


class TrainingPlanDay(Base):
    __tablename__ = "training_plan_days"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("training_plans.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    day_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    sport: Mapped[str] = mapped_column(
        String(20), nullable=False, default="cycle", server_default="cycle"
    )  # cycle, strength, rest
    planned_tss: Mapped[float | None] = mapped_column(Float, nullable=True)
    planned_duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    planned_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="rest"
    )  # rest, easy, moderate, hard, race
    workout_description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    planned_focus: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # squat, bench, deadlift, overhead_press, accessories, full_body
    planned_exercises: Mapped[list[dict] | None] = mapped_column(JSONB, nullable=True)
    planned_volume_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    planned_rpe: Mapped[float | None] = mapped_column(Float, nullable=True)
    planned_power_watts: Mapped[float | None] = mapped_column(Float, nullable=True)
    planned_zone: Mapped[str | None] = mapped_column(String(10), nullable=True)
    planned_route_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="SET NULL"),
        nullable=True,
    )
    lifting_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lifting_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="SET NULL"),
        nullable=True,
    )
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    plan: Mapped["TrainingPlan"] = relationship(back_populates="days")
    activity: Mapped["Activity | None"] = relationship()  # type: ignore[name-defined]
    planned_route: Mapped["Route | None"] = relationship()  # type: ignore[name-defined]
    lifting_session: Mapped["LiftingSession | None"] = relationship()  # type: ignore[name-defined]
