"""Cycling-specific models — FTP tracking and user cycling profile."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CyclingProfile(Base):
    """Per-user cycling profile storing current FTP and weight."""

    __tablename__ = "cycling_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    ftp_watts: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    lactate_threshold_hr: Mapped[float | None] = mapped_column(Float, nullable=True)
    home_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    home_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    auto_estimate_ftp: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # Personalized power model fields (fitted by Modal weekly task)
    critical_power: Mapped[float | None] = mapped_column(Float, nullable=True)
    w_prime: Mapped[float | None] = mapped_column(Float, nullable=True)
    power_model_r_squared: Mapped[float | None] = mapped_column(Float, nullable=True)
    personalized_vo2max: Mapped[float | None] = mapped_column(Float, nullable=True)
    ctl_tau: Mapped[int | None] = mapped_column(Integer, nullable=True)
    atl_tau: Mapped[int | None] = mapped_column(Integer, nullable=True)
    power_model_fitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Weather-performance analysis fields (fitted by Modal weekly task)
    weather_coefficients: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    weather_insights: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    weather_analyzed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="cycling_profile")  # type: ignore[name-defined]


class FtpHistory(Base):
    """Historical record of FTP changes for tracking progression."""

    __tablename__ = "ftp_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ftp_watts: Mapped[float] = mapped_column(Float, nullable=False)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    source: Mapped[str] = mapped_column(
        String(50), nullable=False, default="manual"
    )  # manual, estimated, strava
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="ftp_history")  # type: ignore[name-defined]


class CyclingPowerRecord(Base):
    """Personal best power at a specific duration bucket.

    One record per (user_id, duration_label) — updated in-place when a new
    best is achieved, mirroring the lifting ``PersonalRecord`` pattern.
    Tracks power, weight, and W/kg at the time the PR was set so historical
    PRs don't drift as the user's profile weight changes.
    """

    __tablename__ = "cycling_power_records"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    duration_label: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True
    )  # "5s", "1min", "5min", "20min", "60min", "max", ...
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    power_watts: Mapped[float] = mapped_column(Float, nullable=False)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    w_per_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    improvement_pct: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )
    achieved_date: Mapped[date] = mapped_column(
        Date, nullable=False, index=True
    )
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(
        back_populates="cycling_power_records"
    )  # type: ignore[name-defined]
    activity: Mapped["Activity | None"] = relationship(  # type: ignore[name-defined]
        lazy="joined",
    )
