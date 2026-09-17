"""RPE calibration model — tracks per-user AI vs user RPE offset (§3.18)."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RpeCalibration(Base):
    """Stores the rolling offset between AI-estimated RPE and user-entered RPE.

    ``mean_delta`` = avg(user_rpe - ai_rpe) over the sample window.
    A positive mean_delta means the user typically rates higher than the AI.
    """

    __tablename__ = "rpe_calibrations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        index=True,
        nullable=False,
    )
    exercise_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )  # NULL = aggregate across all exercises

    sample_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mean_delta: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    std_delta: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    exercise_breakdown: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # JSONB — per-exercise stats

    last_updated: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )
