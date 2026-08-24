"""Cached weather responses from Open-Meteo."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CachedWeather(Base):
    """Cached Open-Meteo response keyed by user + weather type + rounded coords.

    ``weather_data`` stores the exact normalized JSON that the API returns,
    so a cache hit is a straight pass-through. ``expires_at`` is NULL for
    historical weather (which never changes once archived).
    """

    __tablename__ = "cached_weather"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    weather_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # current | forecast | historical
    weather_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    cached_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # NULL = never expires (historical)
