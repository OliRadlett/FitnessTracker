import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Route(Base):
    __tablename__ = "routes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # A route is a concrete variant of at most one course. NULL means the route
    # is uncoursed (new import, orphan, or a user who has not grouped it yet).
    # The FK is SET NULL rather than CASCADE: deleting a course must never
    # delete the routes (and rides) that belonged to it.
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("courses.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    sport_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="cycling", index=True
    )
    distance_meters: Mapped[float] = mapped_column(Float, nullable=False)
    elevation_gain_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_time_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    encoded_polyline: Mapped[str] = mapped_column(String, nullable=False)
    elevation_profile: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    surface_profile: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    start_lat: Mapped[float] = mapped_column(Float, nullable=False)
    start_lng: Mapped[float] = mapped_column(Float, nullable=False)
    end_lat: Mapped[float] = mapped_column(Float, nullable=False)
    end_lng: Mapped[float] = mapped_column(Float, nullable=False)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    locality: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_loop: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_favorite: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", index=True
    )
    quality_score: Mapped[float | None] = mapped_column(
        Float, nullable=True, index=True
    )
    # `none_as_null=True` on every column that is *cleared* rather than
    # filled: SQLAlchemy's JSONB default serialises a Python ``None`` as JSON
    # ``null``, which is a real value, not SQL ``NULL``. Assigning ``None`` to
    # these columns therefore appeared to clear them and did not —
    # ``WHERE road_match IS NULL`` does not match a row holding JSON null.
    # These three are cleared whenever a route's geometry changes, and the
    # map-matching tasks select on exactly that predicate.
    terrain_classification: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    # Phase 2 — OSM road-graph map-match (edge set + coverage) and route embedding.
    road_match: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    road_embedding: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    road_match_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Wahoo push state — id of the route uploaded to the user's Wahoo library
    wahoo_route_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    wahoo_route_pushed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Set when the route is excluded from matching because nothing has ever
    # been linked to it (merge residue / absorbed lap-variant twin). NULL means
    # "never quarantined"; the value is the audit of when it was set aside, so
    # it is a timestamp rather than a boolean — re-sweeping must not overwrite
    # the original date. Display paths deliberately do not filter on this: a
    # quarantined route is still the user's route.
    quarantined_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Set when the user has reviewed a quarantined route and rejected it.
    # Separate from quarantined_at because "excluded from matching" and
    # "already looked at" are different facts: with only one column a
    # dismissed route is indistinguishable from one never reviewed, so the
    # review queue never empties. A dismissed route can still be restored
    # without losing the fact that it was judged and rejected.
    dismissed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="routes")  # type: ignore[name-defined]
    course: Mapped["Course | None"] = relationship(  # type: ignore[name-defined]
        "Course", back_populates="routes", foreign_keys=[course_id]
    )
    sources: Mapped[list["RouteSource"]] = relationship(
        back_populates="route", cascade="all, delete-orphan"
    )
    activities: Mapped[list["Activity"]] = relationship(back_populates="route")  # type: ignore[name-defined]
    taggings: Mapped[list["RouteTagging"]] = relationship(  # type: ignore[name-defined]
        "RouteTagging", cascade="all, delete-orphan"
    )
    tags: Mapped[list["RouteTag"]] = relationship(  # type: ignore[name-defined]
        secondary="route_taggings",
        back_populates="routes",
        viewonly=True,
    )
    collection_items: Mapped[list["RouteCollectionItem"]] = relationship(  # type: ignore[name-defined]
        "RouteCollectionItem", cascade="all, delete-orphan"
    )
    # `passive_deletes=True` so the database's ON DELETE CASCADE applies.
    # Without it SQLAlchemy treats the delete as a de-association and sets
    # `route_quality.route_id` to NULL — which that column forbids, so any
    # route carrying a quality row could not be deleted. That included
    # `DELETE /routes/{id}` and every merge, since `merge_routes` also deletes
    # the duplicate row. The error names a table rather than this
    # relationship, so the cause is not obvious from the traceback.
    quality: Mapped["RouteQuality | None"] = relationship(  # type: ignore[name-defined]
        "RouteQuality", back_populates="route", uselist=False, passive_deletes=True
    )


class Course(Base):
    """A course identity: one course can own many route variants.

    ``Route`` is the concrete variant (geometry, direction, start/end,
    provider sources); ``Course`` is the tolerant identity above it. The
    distinction is what lets the review queue say "same course, different
    route" without deleting the variant. A route belongs to at most one
    course; ``canonical_route_id`` is the route used when one row is needed
    (map, export, PR baseline) and is nullable because a course can exist
    before a canonical route is chosen.

    ``identity_source`` records how the course was created: ``legacy`` for the
    1:1 backfill, ``manual`` for a user-created course, ``provider`` when a
    provider object is authoritative, and ``matcher`` when the similarity
    engine proposed the grouping.
    """

    __tablename__ = "courses"
    __table_args__ = (
        # A route can be canonical for at most one course. Partial because
        # most courses may not have a canonical route yet; a plain UNIQUE over
        # a nullable column would allow many NULLs but also would not express
        # the intent as clearly.
        Index(
            "uq_courses_canonical_route",
            "canonical_route_id",
            unique=True,
            postgresql_where=text("canonical_route_id IS NOT NULL"),
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
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    sport_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="cycling", server_default="cycling"
    )
    # `use_alter=True` breaks the courses <-> routes FK cycle for
    # `Base.metadata.create_all()`: courses is created without this FK, routes
    # is created with its `course_id` FK, then this constraint is added.
    canonical_route_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "routes.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_courses_canonical_route_id",
        ),
        nullable=True,
    )
    identity_source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="manual", server_default="manual"
    )
    identity_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    routes: Mapped[list["Route"]] = relationship(
        back_populates="course", foreign_keys="Route.course_id"
    )
    canonical_route: Mapped["Route | None"] = relationship(
        "Route", foreign_keys=[canonical_route_id], post_update=True
    )


class CourseLinkLog(Base):
    """Audit trail for non-destructive course grouping.

    ``RouteMergeLog`` records a destructive merge (the duplicate row is
    deleted). Grouping a variant under a course is an ``UPDATE`` on
    ``routes.course_id``, so it needs its own log: the route still exists and
    the decision can be undone by restoring ``previous_course_id``.
    """

    __tablename__ = "course_link_log"
    __table_args__ = (
        CheckConstraint(
            "action IN ('group', 'ungroup')", name="ck_course_link_log_action"
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
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    # No FK: the previous course may itself have been deleted; the id is kept
    # so an undo can report "the old course no longer exists" rather than
    # silently restoring a dangling link.
    previous_course_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    undone_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class CourseSuggestionDismissal(Base):
    """A durable "these are not the same course" decision.

    The similarity cache is rebuilt (delete + reinsert) on every scan, so a
    dismissal cannot live on ``route_similarity``. This table is keyed by the
    ordered route pair and survives cache rebuilds. The suggestion query skips
    both orientations, so a rebuilt cache cannot re-propose the pair.
    """

    __tablename__ = "course_suggestion_dismissals"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "route_a_id",
            "route_b_id",
            name="uq_course_suggestion_dismissal",
        ),
        CheckConstraint(
            "route_a_id <> route_b_id",
            name="ck_course_suggestion_dismissal_distinct",
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
    route_a_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    route_b_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RouteMergeLog(Base):
    """Audit trail for a route merge so it can be reviewed / undone.

    ``merged_route_id`` is intentionally **not** a FK — the duplicate route row
    is deleted during the merge, and the snapshot below is enough to recreate it.
    """

    __tablename__ = "route_merge_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    primary_route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    merged_route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # Why the merge was made: "identical" (the same route recorded twice) or
    # "variant" (same kind of ride — e.g. different lap counts of one circuit).
    # Only `identical` merges train the embedding metric; variants must never
    # teach the matcher that distinct routes are duplicates.
    merge_kind: Mapped[str | None] = mapped_column(String(20), nullable=True)
    breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    moved: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    undone_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class RouteSimilarity(Base):
    """Cached pairwise route-match scores (Modal / local engine output).

    Keyed by the ordered pair ``(route_a_id, route_b_id)``; the graph is rebuilt
    idempotently per user, so rows are cleared before each upsert.
    """

    __tablename__ = "route_similarity"
    __table_args__ = (
        UniqueConstraint("route_a_id", "route_b_id", name="uq_route_similarity_pair"),
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
    route_a_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    route_b_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    tier: Mapped[str] = mapped_column(String(20), nullable=False, default="none")
    breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RouteMatchMetric(Base):
    """Per-user learned diagonal metric for route embeddings (Phase 2).

    Weights are trained self-supervised on the merge decisions the app
    accumulates (auto-tier ``route_similarity`` pairs as positives, sampled
    dissimilar pairs as negatives).
    """

    __tablename__ = "route_match_metric"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    weights: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    n_positives: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    n_negatives: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    trained_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RouteSource(Base):
    __tablename__ = "route_sources"
    __table_args__ = (
        UniqueConstraint(
            "provider",
            "provider_route_id",
            "user_id",
            name="uq_route_source_provider_user",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # strava, komoot, wahoo, manual
    provider_route_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_name: Mapped[str] = mapped_column(String(500), nullable=False)
    encoded_polyline: Mapped[str] = mapped_column(String, nullable=False)
    raw_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    route: Mapped["Route"] = relationship(back_populates="sources")
