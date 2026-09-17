"""Lift video analysis aggregation model — weekly trend data per exercise (§3.18)."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LiftVideoAnalysis(Base):
    """Aggregated video analysis metrics per exercise for trend tracking.

    Populated weekly by the ``aggregate_video_analyses`` Celery task.
    Stores rolling averages and JSONB trend arrays ({date, value}).
    """

    __tablename__ = "lift_video_analyses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        index=True,
        nullable=False,
    )
    exercise_name: Mapped[str] = mapped_column(
        String(255), index=True, nullable=False
    )

    # Aggregated metrics
    avg_form_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_velocity: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_consistency: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_rpe_accuracy: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )  # mean |ai_rpe - user_rpe|
    video_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Trends (JSONB arrays of {date, value})
    form_trend: Mapped[str | None] = mapped_column(Text, nullable=True)
    velocity_trend: Mapped[str | None] = mapped_column(Text, nullable=True)
    consistency_trend: Mapped[str | None] = mapped_column(Text, nullable=True)

    analyzed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
