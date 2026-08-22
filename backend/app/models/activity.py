import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Activity(Base):
    __tablename__ = "activities"
    __table_args__ = (
        UniqueConstraint(
            "source", "provider_activity_id", name="uq_activity_source_provider_id"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("oauth_connections.id", ondelete="SET NULL"),
        nullable=True,
    )
    route_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # strava, wahoo, manual (primary source)
    provider_activity_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sport_type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # cycling, running, swimming, strength, powerlifting
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    start_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    distance_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    elevation_gain_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_heartrate: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_heartrate: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_power: Mapped[float | None] = mapped_column(Float, nullable=True)
    normalized_power: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_cadence: Mapped[float | None] = mapped_column(Float, nullable=True)
    tss: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )  # Training Stress Score
    calories: Mapped[float | None] = mapped_column(Float, nullable=True)
    rpe: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )  # Rate of Perceived Exertion 1-10
    raw_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="activities")  # type: ignore[name-defined]
    route: Mapped["Route | None"] = relationship(back_populates="activities")  # type: ignore[name-defined]
    streams: Mapped[list["ActivityStream"]] = relationship(
        back_populates="activity", cascade="all, delete-orphan"
    )
    sources: Mapped[list["ActivitySource"]] = relationship(
        back_populates="activity", cascade="all, delete-orphan"
    )
    lifting_session: Mapped["LiftingSession | None"] = relationship(
        back_populates="linked_activity"
    )  # type: ignore[name-defined]


class ActivitySource(Base):
    """Tracks which provider(s) contributed to a merged activity.

    Mirrors the RouteSource pattern — a single logical activity can have
    multiple sources (e.g., the same ride synced from both Strava and Wahoo).
    """

    __tablename__ = "activity_sources"
    __table_args__ = (
        UniqueConstraint(
            "provider", "provider_activity_id", name="uq_activity_source_provider"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # strava, wahoo, komoot
    provider_activity_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_name: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )  # original name from provider
    raw_data: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True
    )  # full API response
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    activity: Mapped["Activity"] = relationship(back_populates="sources")


class ActivityStream(Base):
    __tablename__ = "activity_streams"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    stream_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # heartrate, power, cadence, altitude, velocity
    data: Mapped[dict] = mapped_column(
        JSONB, nullable=False
    )  # array of time-series values
    resolution: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )  # seconds per point

    # Relationships
    activity: Mapped["Activity"] = relationship(back_populates="streams")
