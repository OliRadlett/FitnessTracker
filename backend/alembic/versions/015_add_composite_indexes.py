"""add composite indexes

Revision ID: 015
Revises: 014
Create Date: 2026-08-18
"""

from alembic import op

# revision identifiers
revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Activities: most queries filter by user_id and sort by start_date
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_activities_user_start_date
        ON activities (user_id, start_date DESC)
    """)

    # Daily metrics: dedup and date-range lookups always use (user_id, metric_date)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_daily_metrics_user_date_source
        ON daily_metrics (user_id, metric_date, source)
    """)

    # Lifting sessions: list by user + date
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_lifting_sessions_user_date
        ON lifting_sessions (user_id, session_date DESC)
    """)

    # Personal records: lookup by user + exercise
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_personal_records_user_exercise
        ON personal_records (user_id, exercise_name)
    """)

    # Routes: list by user + sport type
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_routes_user_sport_type
        ON routes (user_id, sport_type)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_activities_user_start_date")
    op.execute("DROP INDEX IF EXISTS ix_daily_metrics_user_date_source")
    op.execute("DROP INDEX IF EXISTS ix_lifting_sessions_user_date")
    op.execute("DROP INDEX IF EXISTS ix_personal_records_user_exercise")
    op.execute("DROP INDEX IF EXISTS ix_routes_user_sport_type")
