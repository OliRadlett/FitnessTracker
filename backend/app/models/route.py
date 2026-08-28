import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
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


class Route(Base):
    __tablename__ = "routes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    sport_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="cycling", index=True
    )
    distance_meters: Mapped[float] = mapped_column(Float, nullable=False)
    elevation_gain_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_time_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    encoded_polyline: Mapped[str] = mapped_column(String, nullable=False)
    elevation_profile: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    surface_profile: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    start_lat: Mapped[float] = mapped_column(Float, nullable=False)
    start_lng: Mapped[float] = mapped_column(Float, nullable=False)
    end_lat: Mapped[float] = mapped_column(Float, nullable=False)
    end_lng: Mapped[float] = mapped_column(Float, nullable=False)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    locality: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_loop: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_favorite: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", index=True
    )
    quality_score: Mapped[float | None] = mapped_column(
        Float, nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="routes")  # type: ignore[name-defined]
    sources: Mapped[list["RouteSource"]] = relationship(
        back_populates="route", cascade="all, delete-orphan"
    )
    activities: Mapped[list["Activity"]] = relationship(back_populates="route")  # type: ignore[name-defined]
    taggings: Mapped[list["RouteTagging"]] = relationship(  # type: ignore[name-defined]
        "RouteTagging", cascade="all, delete-orphan"
    )
    tags: Mapped[list["RouteTag"]] = relationship(  # type: ignore[name-defined]
        secondary="route_taggings",
        back_populates="routes",
        viewonly=True,
    )
    collection_items: Mapped[list["RouteCollectionItem"]] = relationship(  # type: ignore[name-defined]
        "RouteCollectionItem", cascade="all, delete-orphan"
    )
    quality: Mapped["RouteQuality | None"] = relationship(  # type: ignore[name-defined]
        "RouteQuality", back_populates="route", uselist=False
    )


class RouteSource(Base):
    __tablename__ = "route_sources"
    __table_args__ = (
        UniqueConstraint(
            "provider", "provider_route_id", name="uq_route_source_provider"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # strava, komoot, wahoo, manual
    provider_route_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_name: Mapped[str] = mapped_column(String(500), nullable=False)
    encoded_polyline: Mapped[str] = mapped_column(String, nullable=False)
    raw_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    route: Mapped["Route"] = relationship(back_populates="sources")
