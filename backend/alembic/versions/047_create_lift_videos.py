"""Add lift_videos table for §1.1 strength video system.

Supports two storage modes selected by the `source` column:
- "url"    : externally hosted (YouTube/Vimeo) embed — `external_url`.
- "upload" : R2 presigned upload — `r2_key` (requires S3 creds; endpoints 501
  without them).

Revision ID: 047
Revises: 046
Create Date: 2026-09-08
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "047"
down_revision = "046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lift_videos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("external_url", sa.String(2000), nullable=True),
        sa.Column("r2_key", sa.String(255), nullable=True, index=True),
        sa.Column("file_name", sa.String(255), nullable=True),
        sa.Column("content_type", sa.String(100), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("exercise_name", sa.String(255), nullable=True, index=True),
        sa.Column(
            "lifting_session_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "personal_record_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["lifting_session_id"], ["lifting_sessions.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["personal_record_id"], ["personal_records.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.CheckConstraint("source IN ('upload', 'url')", name="ck_lift_videos_source"),
    )


def downgrade() -> None:
    op.drop_table("lift_videos")
