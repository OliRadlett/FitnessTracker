"""Add ``provider_webhook_events`` — one queue for non-Strava webhooks.

Whoop has webhooks (six event types, HMAC-signed) and we poll instead, so sleep
and recovery updates surface up to half an hour late. Wahoo and Withings will
follow, which is why this is one table keyed on ``provider`` rather than three
bespoke queues: three of them would triple the surface for the same shape.

The handler only verifies and enqueues (AGENTS pitfall 9); a Celery drain does the
work. ``dedupe_key`` carries the provider's own event id — Whoop sends
``trace_id`` and retries — so a redelivery cannot re-run a sync. The unique index
is partial because providers without an id leave it NULL (pitfall 31).

Revision ID: 116
Revises: 115
Create Date: 2026-11-05
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "116"
down_revision = "115"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_webhook_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("provider_user_id", sa.String(length=64), nullable=True),
        sa.Column("dedupe_key", sa.String(length=64), nullable=True),
        sa.Column(
            "payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "status", sa.String(length=20), nullable=False, server_default="pending"
        ),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_provider_webhook_events_status",
        "provider_webhook_events",
        ["status"],
    )
    op.create_index(
        "uq_provider_webhook_dedupe",
        "provider_webhook_events",
        ["provider", "dedupe_key"],
        unique=True,
        postgresql_where=sa.text("dedupe_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_provider_webhook_dedupe", table_name="provider_webhook_events")
    op.drop_index(
        "ix_provider_webhook_events_status", table_name="provider_webhook_events"
    )
    op.drop_table("provider_webhook_events")
