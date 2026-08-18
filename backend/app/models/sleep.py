import uuid
from datetime import date, datetime

from sqlalchemy import (
    Date,
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


class SleepLog(Base):
    __tablename__ = "sleep_logs"
    __table_args__ = (
        UniqueConstraint("user_id", "sleep_date", "source", name="uq_sleep_log_user_date_source"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    sleep_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(50), nullable=False)  # whoop
    total_sleep_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deep_sleep_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rem_sleep_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    light_sleep_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    awake_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sleep_efficiency: Mapped[float | None] = mapped_column(Float, nullable=True)
    sleep_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sleep_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user: Mapped["User"] = relationship(back_populates="sleep_logs")  # type: ignore[name-defined]
