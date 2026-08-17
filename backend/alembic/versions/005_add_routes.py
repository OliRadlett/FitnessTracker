"""Add routes and route_sources tables.

Revision ID: 005
Revises: 004
Create Date: 2026-08-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

# revision identifiers
revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use IF NOT EXISTS to handle the case where Base.metadata.create_all
    # in main.py already created these tables on startup.
    op.execute("""
        CREATE TABLE IF NOT EXISTS routes (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            user_id UUID NOT NULL,
            name VARCHAR(500) NOT NULL,
            sport_type VARCHAR(50) DEFAULT 'cycling' NOT NULL,
            distance_meters FLOAT NOT NULL,
            elevation_gain_meters FLOAT,
            estimated_time_seconds INTEGER,
            encoded_polyline TEXT NOT NULL,
            elevation_profile JSONB,
            start_lat FLOAT NOT NULL,
            start_lng FLOAT NOT NULL,
            end_lat FLOAT NOT NULL,
            end_lng FLOAT NOT NULL,
            country VARCHAR(100),
            locality VARCHAR(200),
            is_loop BOOLEAN DEFAULT false NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (id),
            FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS route_sources (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            route_id UUID NOT NULL,
            provider VARCHAR(50) NOT NULL,
            provider_route_id VARCHAR(255) NOT NULL,
            provider_name VARCHAR(500) NOT NULL,
            encoded_polyline TEXT NOT NULL,
            raw_data JSONB,
            synced_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (id),
            FOREIGN KEY(route_id) REFERENCES routes (id) ON DELETE CASCADE,
            UNIQUE (provider, provider_route_id)
        )
    """)

    # Create indexes only if they don't exist
    op.execute("CREATE INDEX IF NOT EXISTS ix_routes_sport_type ON routes (sport_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_routes_user_id ON routes (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_route_sources_route_id ON route_sources (route_id)")


def downgrade() -> None:
    op.drop_table("route_sources")
    op.execute("DROP INDEX IF EXISTS ix_routes_user_id")
    op.execute("DROP INDEX IF EXISTS ix_routes_sport_type")
    op.drop_table("routes")
