"""cleanup self-heal: ensure columns/tables from earlier migrations exist

Revision ID: 016
Revises: 015
Create Date: 2026-08-18
"""

from alembic import op

# revision identifiers
revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # These columns/tables were added by earlier migrations but may be missing
    # on installs that ran the old self-heal logic in main.py instead of Alembic.
    # All statements are idempotent (IF NOT EXISTS).

    # From migration 010: route_id on activities
    op.execute("ALTER TABLE activities ADD COLUMN IF NOT EXISTS route_id UUID")
    op.execute("CREATE INDEX IF NOT EXISTS ix_activities_route_id ON activities(route_id)")

    # From migration 009: activity_sources table
    op.execute("""
        CREATE TABLE IF NOT EXISTS activity_sources (
            id UUID PRIMARY KEY,
            activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
            provider VARCHAR(50) NOT NULL,
            provider_activity_id VARCHAR(255) NOT NULL,
            provider_name VARCHAR(500),
            raw_data JSONB,
            synced_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            CONSTRAINT uq_activity_source_provider UNIQUE (provider, provider_activity_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_activity_sources_activity_id ON activity_sources(activity_id)")

    # From migration 008: created_at on lifting_sets
    op.execute("ALTER TABLE lifting_sets ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL")


def downgrade() -> None:
    # These are safety-net idempotent checks; downgrading them could break
    # other migrations that depend on them, so leave them in place.
    pass
