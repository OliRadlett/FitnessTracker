"""Route tags, collections, and quality scoring models."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RouteTag(Base):
    """User-defined tag for grouping routes (flat, multi-assign)."""

    __tablename__ = "route_tags"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    taggings: Mapped[list["RouteTagging"]] = relationship(
        back_populates="tag", cascade="all, delete-orphan"
    )
    routes: Mapped[list["Route"]] = relationship(
        secondary="route_taggings",
        back_populates="tags",
        viewonly=True,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_route_tag_user_name"),
    )


class RouteTagging(Base):
    """Association between Route and RouteTag."""

    __tablename__ = "route_taggings"

    route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("route_tags.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tagged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    tag: Mapped["RouteTag"] = relationship(
        back_populates="taggings", overlaps="routes"
    )
    route: Mapped["Route"] = relationship(overlaps="taggings,tag")


class RouteCollection(Base):
    """Manual or smart (rule-based) collection of routes."""

    __tablename__ = "route_collections"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    is_smart: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    rules: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    items: Mapped[list["RouteCollectionItem"]] = relationship(
        back_populates="collection", cascade="all, delete-orphan"
    )


class RouteCollectionItem(Base):
    """Association between RouteCollection and Route (manual collections only)."""

    __tablename__ = "route_collection_items"

    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("route_collections.id", ondelete="CASCADE"),
        primary_key=True,
    )
    route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    collection: Mapped["RouteCollection"] = relationship(
        back_populates="items", overlaps="route"
    )
    route: Mapped["Route"] = relationship(
        overlaps="items,collection,collection_items"
    )


class RouteQuality(Base):
    """Cached route quality scores (computed by nightly Celery task)."""

    __tablename__ = "route_quality"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    completeness_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    popularity_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    surface_quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    effort_match_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    route: Mapped["Route"] = relationship(back_populates="quality")
