"""Add Course identity above Route variants.

Revision ID: 116
Revises: 115

A route is a concrete variant; a course is the tolerant identity above it.
This migration is additive and reversible:

* creates ``courses`` and ``course_link_log``
* adds ``routes.course_id`` (nullable; NULL = uncoursed)
* backfills **one course per existing route** (1:1), with
  ``identity_source='legacy'``

It deliberately does **not** group variants, delete routes, or touch
activities. The 86 -> 79 grouping is a review action, not a migration. See
``plans/route-courses-2026-11-05.md`` and the investigation lab's
``SCHEMA-PLAN.md``.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "116"
down_revision = "115"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "courses",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=500), nullable=False),
        sa.Column(
            "sport_type",
            sa.String(length=50),
            nullable=False,
            server_default="cycling",
        ),
        sa.Column("canonical_route_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "identity_source",
            sa.String(length=20),
            nullable=False,
            server_default="manual",
        ),
        sa.Column("identity_confidence", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_courses_user_id", ondelete="CASCADE"
        ),
    )
    op.create_index("ix_courses_user_id", "courses", ["user_id"])
    op.create_index("ix_courses_user_sport", "courses", ["user_id", "sport_type"])
    # A route can be canonical for at most one course. Partial because a
    # course may not have a canonical route yet.
    op.create_index(
        "uq_courses_canonical_route",
        "courses",
        ["canonical_route_id"],
        unique=True,
        postgresql_where=sa.text("canonical_route_id IS NOT NULL"),
    )
    # Added separately so the courses <-> routes FK cycle is explicit and the
    # constraint has a stable name for downgrade.
    op.create_foreign_key(
        "fk_courses_canonical_route_id",
        "courses",
        "routes",
        ["canonical_route_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "routes",
        sa.Column("course_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_routes_course_id", "routes", ["course_id"])
    op.create_foreign_key(
        "fk_routes_course_id",
        "routes",
        "courses",
        ["course_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "course_link_log",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("course_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("route_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("previous_course_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("breakdown", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_course_link_log_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name="fk_course_link_log_course_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["route_id"],
            ["routes.id"],
            name="fk_course_link_log_route_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "action IN ('group', 'ungroup')", name="ck_course_link_log_action"
        ),
    )
    op.create_index("ix_course_link_log_user_id", "course_link_log", ["user_id"])
    op.create_index("ix_course_link_log_course_id", "course_link_log", ["course_id"])
    op.create_index("ix_course_link_log_route_id", "course_link_log", ["route_id"])

    # 1:1 backfill. One course per existing route; no grouping. Idempotent:
    # the WHERE guards make a rerun a no-op.
    op.execute(
        """
        WITH new_courses AS (
            INSERT INTO courses
                (id, user_id, name, sport_type, canonical_route_id,
                 identity_source, identity_confidence)
            SELECT gen_random_uuid(), r.user_id, r.name, r.sport_type, r.id,
                   'legacy', NULL
            FROM routes r
            WHERE r.course_id IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM courses c WHERE c.canonical_route_id = r.id
              )
            RETURNING id, canonical_route_id
        )
        UPDATE routes r
        SET course_id = c.id
        FROM new_courses c
        WHERE c.canonical_route_id = r.id
        """
    )


def downgrade() -> None:
    # Safe before grouping. After grouping, export course_link_log first:
    # dropping it loses the grouping decisions, though no route is deleted.
    op.drop_table("course_link_log")

    op.drop_constraint("fk_routes_course_id", "routes", type_="foreignkey")
    op.drop_index("ix_routes_course_id", table_name="routes")
    op.drop_column("routes", "course_id")

    op.drop_constraint("fk_courses_canonical_route_id", "courses", type_="foreignkey")
    op.drop_index("uq_courses_canonical_route", table_name="courses")
    op.drop_index("ix_courses_user_sport", table_name="courses")
    op.drop_index("ix_courses_user_id", table_name="courses")
    op.drop_table("courses")
