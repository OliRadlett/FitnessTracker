"""Strava webhook event queue.

Strava webhook POSTs are persisted here and processed asynchronously by a
Celery task (instead of synchronously inside the HTTP request). This gives
retries, ordering, and observability — a lost/failed event can be replayed
and a periodic reconciliation pass heals any residual drift.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StravaWebhookEvent(Base):
    __tablename__ = "strava_webhook_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    aspect_type: Mapped[str] = mapped_column(String(20), nullable=False)
    object_type: Mapped[str] = mapped_column(String(20), nullable=False)
    object_id: Mapped[str] = mapped_column(String(64), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updates: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)


class ProviderWebhookEvent(Base):
    """Webhook queue for providers other than Strava (Whoop first).

    Same contract as :class:`StravaWebhookEvent` — verify and **enqueue only** in
    the HTTP handler, process in a Celery drain — but keyed on ``provider`` from
    day one so Whoop, Wahoo and Withings share one table rather than three.
    Three bespoke queues would triple the surface for the same shape, and the
    provider is the only thing that actually differs.

    ``dedupe_key`` is the provider's own event id where it has one (Whoop's
    ``trace_id``), which is what makes the unique index meaningful: providers
    retry, and a retried event must not re-run a sync. It is partial because
    providers without an id (and Strava-shaped events) leave it NULL, and a
    unique constraint over NULLs constrains nothing (AGENTS pitfall 31).
    """

    __tablename__ = "provider_webhook_events"
    __table_args__ = (
        sa.Index(
            "uq_provider_webhook_dedupe",
            "provider",
            "dedupe_key",
            unique=True,
            postgresql_where=sa.text("dedupe_key IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    #: "whoop" today; "wahoo" / "withings" when their handlers land.
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    #: The provider's event type, verbatim (e.g. "sleep.updated").
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    #: The provider's own user identifier, resolved to an OAuthConnection later.
    provider_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)