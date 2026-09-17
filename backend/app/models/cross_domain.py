"""Cross-domain insights model.

Stores weekly cross-domain correlation analysis results (sleep-performance,
cross-sport fatigue, race retrospective) computed by Modal.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CrossDomainInsight(Base):
    """Per-user cross-domain analysis results."""

    __tablename__ = "cross_domain_insights"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    insight_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # sleep_performance, cross_sport, race_retrospective
    # Analysis period
    period_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Results stored as JSONB
    results: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Human-readable insights
    insights: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Data quality metadata
    data_quality: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="cross_domain_insights")  # type: ignore[name-defined]
