import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.services.encryption import EncryptedString


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    connections: Mapped[list["OAuthConnection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    activities: Mapped[list["Activity"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    lifting_sessions: Mapped[list["LiftingSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    daily_metrics: Mapped[list["DailyMetric"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    sleep_logs: Mapped[list["SleepLog"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    personal_records: Mapped[list["PersonalRecord"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    health_alerts: Mapped[list["HealthAlert"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    warmup_templates: Mapped[list["WarmupTemplate"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    routes: Mapped[list["Route"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    cycling_profile: Mapped["CyclingProfile | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    ftp_history: Mapped[list["FtpHistory"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    weight_logs: Mapped[list["WeightLog"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    goals: Mapped[list["Goal"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    training_plans: Mapped[list["TrainingPlan"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    events: Mapped[list["Event"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    llm_analyses: Mapped[list["LlmAnalysis"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]
    fuel_plans: Mapped[list["RideFuelPlan"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )  # type: ignore[name-defined]


class OAuthConnection(Base):
    __tablename__ = "oauth_connections"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_oauth_user_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # strava, whoop, wahoo, google, github
    access_token: Mapped[str] = mapped_column(EncryptedString(1024), nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(
        EncryptedString(1024), nullable=True
    )
    token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    provider_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Connection health — BUG-072: a revoked/expired token must not be retried
    # forever with no user signal. status=needs_reauth short-circuits syncs and
    # is surfaced in the UI; consecutive_failures backs off transient errors.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", server_default="active"
    )
    consecutive_failures: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_error_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_refreshed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="connections")
