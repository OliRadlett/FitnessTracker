import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class LiftingSession(Base):
    __tablename__ = "lifting_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="SET NULL"),
        nullable=True,
    )
    session_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    program_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    focus: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )  # squat, bench, deadlift, overhead_press, accessories
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_volume_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    rpe_session: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    # Live-session tracking (set only by /lifting/live flow)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Client-generated key for idempotent live-session creation (retries and
    # concurrent flushes collapse onto the same session). NULL = manual session.
    live_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Whoop workout enrichment via time-overlap match (sync_whoop_workouts)
    whoop_strain: Mapped[float | None] = mapped_column(Float, nullable=True)
    whoop_avg_hr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    whoop_max_hr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    whoop_kilojoules: Mapped[float | None] = mapped_column(Float, nullable=True)
    whoop_workout_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="lifting_sessions")  # type: ignore[name-defined]
    sets: Mapped[list["LiftingSet"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="LiftingSet.created_at",
    )
    linked_activity: Mapped["Activity | None"] = relationship(
        back_populates="lifting_session"
    )  # type: ignore[name-defined]


class LiftingSet(Base):
    __tablename__ = "lifting_sets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lifting_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    exercise_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    set_number: Mapped[int] = mapped_column(Integer, nullable=False)
    weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
    reps: Mapped[int] = mapped_column(Integer, nullable=False)
    rpe: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_warmup: Mapped[bool] = mapped_column(Boolean, default=False)
    is_amrap: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Client-generated id for idempotent live-sync set logging. NULL = manual entry.
    client_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    session: Mapped["LiftingSession"] = relationship(back_populates="sets")


class PersonalRecord(Base):
    __tablename__ = "personal_records"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    exercise_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    record_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # 1rm, 3rm, 5rm, volume_pr
    weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
    reps: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_1rm: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )  # Brzycki formula
    achieved_date: Mapped[date] = mapped_column(Date, nullable=False)
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="SET NULL"),
        nullable=True,
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lifting_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="personal_records")  # type: ignore[name-defined]


class WarmupTemplate(Base):
    __tablename__ = "warmup_templates"

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
    exercise_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="warmup_templates")  # type: ignore[name-defined]
    steps: Mapped[list["WarmupTemplateStep"]] = relationship(
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="WarmupTemplateStep.step_number",
    )


class WarmupTemplateStep(Base):
    __tablename__ = "warmup_template_steps"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    warmup_template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("warmup_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    step_number: Mapped[int] = mapped_column(Integer, nullable=False)
    weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
    reps: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Relationships
    template: Mapped["WarmupTemplate"] = relationship(back_populates="steps")
