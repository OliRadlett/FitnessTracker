import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Gear(Base):
    """A physical bike or pair of shoes, as a provider knows it.

    Gear is a table rather than a bare ``activities.gear_id`` string because the
    durable object is *the bike in the garage*: a provider can rename it (Strava's
    ``name`` is brand + model + nickname) without it becoming a different object,
    and its distance accumulates across every ride that ever referenced it. Storing
    the string alone meant the same bike appeared as two "different" gears when a
    user renamed it, and no query could ask "how far has this chain gone".

    ``provider_gear_id`` is provider-scoped: Strava's ids are strings ("b1234567"),
    and the unique key is per user so a shared bike id cannot collide across
    accounts.
    """

    __tablename__ = "gear"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "provider",
            "provider_gear_id",
            name="uq_gear_user_provider_provider_id",
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
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    provider_gear_id: Mapped[str] = mapped_column(String(64), nullable=False)
    #: Provider display name — Strava returns brand + model + nickname.
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    #: "bike" | "shoes" | "other", derived from the provider's own type fields.
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="other")
    brand_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    #: The provider's cumulative metres for this gear. It includes use that
    #: predates FitTrack, so it is "distance on this gear", not "distance we saw".
    distance_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: When ``distance_meters`` was last refreshed. The sync refreshes at most
    #: once a day per gear: the value is a slowly-moving total, and one call per
    #: gear per 30-minute sync would spend the read bucket on a number that
    #: changed by a single ride.
    distance_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Service interval in metres, **chosen by the user** — deliberately not
    #: defaulted. A "correct" chain or shoe interval depends on conditions, load
    #: and the shoe in question, and inventing one would be a number presented as
    #: knowledge. NULL means the user has not set one, and the API reports no
    #: wear percentage rather than a fabricated one.
    wear_threshold_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    retired_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="gear")  # type: ignore[name-defined]
    activities: Mapped[list["Activity"]] = relationship(  # type: ignore[name-defined]
        back_populates="gear"
    )
