"""add sleep_log unique constraint

Revision ID: 013
Revises: 012
Create Date: 2026-08-17
"""

from alembic import op

# revision identifiers
revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add unique constraint on (user_id, sleep_date, source) to prevent duplicate sleep records
    op.execute("""
        ALTER TABLE sleep_logs
        ADD CONSTRAINT uq_sleep_log_user_date_source
        UNIQUE (user_id, sleep_date, source)
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE sleep_logs
        DROP CONSTRAINT IF EXISTS uq_sleep_log_user_date_source
    """)
