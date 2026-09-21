"""AthleteInsight model (Feature 3 / B-15).

Stores deterministic, observed cross-domain coefficients computed nightly
from the user's own data — recovery cost per session type, sleep→performance
bands, load-composition vs readiness, context power norms, PR-outcome
clustering, and personal TSB peak bands. Associations only, never causation.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AthleteInsight(Base):
    """One computed insight snapshot for a user."""

    __tablename__ = "athlete_insights"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # recovery_cost | sleep_performance | load_readiness | power_norms |
    # pr_clustering | tsb_peak
    insight_type: Mapped[str] = mapped_column(String(50), nullable=False)
    period: Mapped[str] = mapped_column(
        String(20), nullable=False, default="90d"
    )  # analysis window label
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Deterministic coefficients / band tables (JSON-serializable)
    data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # collecting | low | medium | high
    confidence: Mapped[str] = mapped_column(String(20), nullable=False, default="collecting")
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="athlete_insights")  # type: ignore[name-defined]
