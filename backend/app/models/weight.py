import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class WeightLog(Base):
    __tablename__ = "weight_logs"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "date", "source", name="uq_weight_log_user_date_source"
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
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    weight_kilogram: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # whoop, manual, withings
    # Body composition (Withings scales via BIA; manual entries may fill a subset).
    # All nullable so existing Whoop/manual rows are unaffected.
    body_fat_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_mass_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    lean_mass_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    muscle_mass_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    bone_mass_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    hydration_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    visceral_fat_index: Mapped[float | None] = mapped_column(Float, nullable=True)
    bmi: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="weight_logs")  # type: ignore[name-defined]
