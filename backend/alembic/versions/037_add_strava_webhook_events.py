"""Strava webhook event queue table (async processing).

Strava webhook POSTs are acknowledged immediately and the payload is queued
for a Celery task to process with retries, rather than being handled inline
in the HTTP request.

Revision ID: 037
Revises: 036
Create Date: 2026-08-26
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "strava_webhook_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("aspect_type", sa.String(20), nullable=False),
        sa.Column("object_type", sa.String(20), nullable=False),
        sa.Column("object_id", sa.String(64), nullable=False),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("raw_data", JSONB(), nullable=False),
        sa.Column("updates", JSONB(), nullable=True),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "status", sa.String(20), nullable=False, server_default="pending"
        ),
        sa.Column("error", sa.String(500), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_strava_webhook_events_status_received",
        "strava_webhook_events",
        ["status", "received_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_strava_webhook_events_status_received", table_name="strava_webhook_events"
    )
    op.drop_table("strava_webhook_events")