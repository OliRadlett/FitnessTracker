"""Durable dismissal for course-pair suggestions.

Revision ID: 119
Revises: 118

The similarity cache is rebuilt on every scan, so a "not the same course"
decision cannot live on ``route_similarity``. It lives here, keyed by the
ordered route pair, and the suggestion query skips both orientations.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "119"
down_revision = "118"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "course_suggestion_dismissals",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("route_a_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("route_b_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_course_suggestion_dismissal_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["route_a_id"],
            ["routes.id"],
            name="fk_course_suggestion_dismissal_route_a_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["route_b_id"],
            ["routes.id"],
            name="fk_course_suggestion_dismissal_route_b_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "user_id",
            "route_a_id",
            "route_b_id",
            name="uq_course_suggestion_dismissal",
        ),
        sa.CheckConstraint(
            "route_a_id <> route_b_id",
            name="ck_course_suggestion_dismissal_distinct",
        ),
    )
    op.create_index(
        "ix_course_suggestion_dismissal_user_id",
        "course_suggestion_dismissals",
        ["user_id"],
    )
    op.create_index(
        "ix_course_suggestion_dismissal_route_a_id",
        "course_suggestion_dismissals",
        ["route_a_id"],
    )
    op.create_index(
        "ix_course_suggestion_dismissal_route_b_id",
        "course_suggestion_dismissals",
        ["route_b_id"],
    )


def downgrade() -> None:
    op.drop_table("course_suggestion_dismissals")
