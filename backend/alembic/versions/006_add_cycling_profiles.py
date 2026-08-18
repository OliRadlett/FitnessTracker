"""Add cycling_profiles and ftp_history tables.

Revision ID: 006
Revises: 005
Create Date: 2026-08-16
"""

from alembic import op

# revision identifiers
revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS cycling_profiles (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            user_id UUID NOT NULL,
            ftp_watts FLOAT,
            weight_kg FLOAT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            CONSTRAINT pk_cycling_profiles PRIMARY KEY (id),
            CONSTRAINT uq_cycling_profiles_user UNIQUE (user_id),
            CONSTRAINT fk_cycling_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_cycling_profiles_user ON cycling_profiles(user_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS ftp_history (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            user_id UUID NOT NULL,
            ftp_watts FLOAT NOT NULL,
            effective_date DATE NOT NULL,
            source VARCHAR(50) DEFAULT 'manual' NOT NULL,
            notes VARCHAR(500),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            CONSTRAINT pk_ftp_history PRIMARY KEY (id),
            CONSTRAINT fk_ftp_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_ftp_history_user ON ftp_history(user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ftp_history")
    op.execute("DROP TABLE IF EXISTS cycling_profiles")
