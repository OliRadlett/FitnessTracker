"""Add activity_sources table for multi-provider activity merging.

Revision ID: 009
Revises: 008
Create Date: 2026-08-16
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

# revision identifiers
revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create activity_sources table
    op.create_table(
        "activity_sources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "activity_id",
            UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("provider_activity_id", sa.String(255), nullable=False),
        sa.Column("provider_name", sa.String(500), nullable=True),
        sa.Column("raw_data", JSONB, nullable=True),
        sa.Column(
            "synced_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "provider", "provider_activity_id", name="uq_activity_source_provider"
        ),
    )

    # Backfill: create ActivitySource rows from existing Activity data
    op.execute("""
        INSERT INTO activity_sources (id, activity_id, provider, provider_activity_id, synced_at)
        SELECT
            gen_random_uuid(),
            id,
            source,
            COALESCE(provider_activity_id, source || '_' || id::text),
            COALESCE(synced_at, created_at)
        FROM activities
        WHERE source IS NOT NULL
    """)


def downgrade() -> None:
    op.drop_table("activity_sources")
