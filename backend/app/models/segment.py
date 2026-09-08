"""Ride segment models (§3.13).

Segments are geometry-defined climbing sections extracted from a Route's
polyline + elevation profile. ``SegmentEffort`` rows capture one rider's
pass through a segment per activity (elapsed time, power, HR, speed, VAM)
so a segment can be ranked leaderboard-of-self.
"""

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
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Segment(Base):
    __tablename__ = "segments"
    __table_args__ = (
        UniqueConstraint(
            "route_id", "start_dist_m", "end_dist_m", name="uq_segments_route_range"
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
    route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Position along the route (meters from route start).
    start_dist_m: Mapped[float] = mapped_column(Float, nullable=False)
    end_dist_m: Mapped[float] = mapped_column(Float, nullable=False)
    distance_m: Mapped[float] = mapped_column(Float, nullable=False)
    elevation_gain_m: Mapped[float] = mapped_column(Float, nullable=False)
    avg_gradient_pct: Mapped[float] = mapped_column(Float, nullable=False)
    max_gradient_pct: Mapped[float] = mapped_column(Float, nullable=False)
    peak_elevation_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_lat: Mapped[float] = mapped_column(Float, nullable=False)
    start_lng: Mapped[float] = mapped_column(Float, nullable=False)
    end_lat: Mapped[float] = mapped_column(Float, nullable=False)
    end_lng: Mapped[float] = mapped_column(Float, nullable=False)
    climb_category: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # Best-effort denormalized totals (leaderboard headline).
    pr_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    best_avg_power_watts: Mapped[float | None] = mapped_column(Float, nullable=True)
    times_ridden: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    has_pr: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship()  # type: ignore[name-defined]
    route: Mapped["Route"] = relationship()  # type: ignore[name-defined]
    efforts: Mapped[list["SegmentEffort"]] = relationship(
        back_populates="segment", cascade="all, delete-orphan"
    )


class SegmentEffort(Base):
    """One rider's pass through a segment (per activity)."""

    __tablename__ = "segment_efforts"
    __table_args__ = (
        UniqueConstraint(
            "segment_id", "activity_id", name="uq_segment_efforts_segment_activity"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    segment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("segments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    elapsed_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    avg_power_watts: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_hr: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_speed_mps: Mapped[float] = mapped_column(Float, nullable=False)
    effort_vam: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_pr: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    segment: Mapped["Segment"] = relationship(back_populates="efforts")
    activity: Mapped["Activity"] = relationship()  # type: ignore[name-defined]
