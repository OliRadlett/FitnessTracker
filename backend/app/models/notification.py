"""In-app notification model."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Supported notification types. Mirrors the per-user preference keys.
NOTIFICATION_TYPES = ("health_alert", "pr", "goal_milestone", "plan_reminder")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        # Idempotent creation guard — a (user_id, dedup_key) pair may appear at
        # most once. The service also checks before inserting, this makes it
        # safe under racing workers.
        Index(
            "uq_notifications_user_dedup",
            "user_id",
            "dedup_key",
            unique=True,
            postgresql_where=text("dedup_key IS NOT NULL"),
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
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(String(500), nullable=False)
    severity: Mapped[str] = mapped_column(
        String(10), nullable=False, default="info", server_default="info"
    )  # info, success, warning, error
    link: Mapped[str] = mapped_column(
        String(200), nullable=False, default="", server_default=""
    )  # frontend route path
    read: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dedup_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # SQLAlchemy reserves the attribute name `metadata`, so the Python property
    # is `payload` mapped onto the DB column `metadata`.
    payload: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="notifications")  # type: ignore[name-defined]