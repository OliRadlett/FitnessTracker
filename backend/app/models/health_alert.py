import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class HealthAlert(Base):
    __tablename__ = "health_alerts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    alert_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # overtraining, illness_risk, injury_risk, sleep_decline, hrv_drop, performance_decline
    severity: Mapped[str] = mapped_column(String(20), nullable=False)  # info, warning, critical
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(2000), nullable=False)
    evidence: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    detected_date: Mapped[date] = mapped_column(Date, nullable=False)
    dismissed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")  # active, acknowledged, dismissed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user: Mapped["User"] = relationship(back_populates="health_alerts")  # type: ignore[name-defined]
