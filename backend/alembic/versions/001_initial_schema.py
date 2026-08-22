"""Initial schema — all tables

Revision ID: 001
Revises: None
Create Date: 2026-08-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # users
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("avatar_url", sa.String(512), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )

    # oauth_connections
    op.create_table(
        "oauth_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("access_token", sa.String(1024), nullable=False),
        sa.Column("refresh_token", sa.String(1024), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_user_id", sa.String(255), nullable=False),
        sa.Column("provider_metadata", postgresql.JSONB, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )

    # activities
    op.create_table(
        "activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "connection_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("oauth_connections.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("provider_activity_id", sa.String(255), nullable=True),
        sa.Column("sport_type", sa.String(50), nullable=False, index=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("duration_seconds", sa.Integer, nullable=True),
        sa.Column("distance_meters", sa.Float, nullable=True),
        sa.Column("elevation_gain_meters", sa.Float, nullable=True),
        sa.Column("average_heartrate", sa.Float, nullable=True),
        sa.Column("max_heartrate", sa.Float, nullable=True),
        sa.Column("average_power", sa.Float, nullable=True),
        sa.Column("normalized_power", sa.Float, nullable=True),
        sa.Column("average_speed", sa.Float, nullable=True),
        sa.Column("average_cadence", sa.Float, nullable=True),
        sa.Column("tss", sa.Float, nullable=True),
        sa.Column("calories", sa.Float, nullable=True),
        sa.Column("rpe", sa.Float, nullable=True),
        sa.Column("raw_data", postgresql.JSONB, nullable=True),
        sa.Column(
            "synced_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "source", "provider_activity_id", name="uq_activity_source_provider_id"
        ),
    )

    # activity_streams
    op.create_table(
        "activity_streams",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "activity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("stream_type", sa.String(50), nullable=False),
        sa.Column("data", postgresql.JSONB, nullable=False),
        sa.Column("resolution", sa.Integer, nullable=True),
    )

    # lifting_sessions
    op.create_table(
        "lifting_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "activity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("session_date", sa.Date, nullable=False, index=True),
        sa.Column("program_name", sa.String(255), nullable=True),
        sa.Column("focus", sa.String(100), nullable=True),
        sa.Column("duration_seconds", sa.Integer, nullable=True),
        sa.Column("total_volume_kg", sa.Float, nullable=True),
        sa.Column("rpe_session", sa.Float, nullable=True),
        sa.Column("notes", sa.String(2000), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )

    # lifting_sets
    op.create_table(
        "lifting_sets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("lifting_sessions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("exercise_name", sa.String(255), nullable=False, index=True),
        sa.Column("set_number", sa.Integer, nullable=False),
        sa.Column("weight_kg", sa.Float, nullable=False),
        sa.Column("reps", sa.Integer, nullable=False),
        sa.Column("rpe", sa.Float, nullable=True),
        sa.Column("is_warmup", sa.Boolean, default=False),
        sa.Column("is_amrap", sa.Boolean, default=False),
        sa.Column("notes", sa.String(500), nullable=True),
    )

    # personal_records
    op.create_table(
        "personal_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("exercise_name", sa.String(255), nullable=False, index=True),
        sa.Column("record_type", sa.String(20), nullable=False),
        sa.Column("weight_kg", sa.Float, nullable=False),
        sa.Column("reps", sa.Integer, nullable=False),
        sa.Column("estimated_1rm", sa.Float, nullable=True),
        sa.Column("achieved_date", sa.Date, nullable=False),
        sa.Column(
            "activity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("lifting_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )

    # daily_metrics
    op.create_table(
        "daily_metrics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("metric_date", sa.Date, nullable=False, index=True),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("recovery_score", sa.Float, nullable=True),
        sa.Column("hrv_ms", sa.Float, nullable=True),
        sa.Column("resting_hr", sa.Float, nullable=True),
        sa.Column("respiratory_rate", sa.Float, nullable=True),
        sa.Column("sleep_duration_minutes", sa.Float, nullable=True),
        sa.Column("sleep_efficiency", sa.Float, nullable=True),
        sa.Column("strain", sa.Float, nullable=True),
        sa.Column("calories", sa.Float, nullable=True),
        sa.Column("raw_data", postgresql.JSONB, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "user_id", "metric_date", "source", name="uq_daily_metric_user_date_source"
        ),
    )

    # sleep_logs
    op.create_table(
        "sleep_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("sleep_date", sa.Date, nullable=False, index=True),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("total_sleep_seconds", sa.Integer, nullable=True),
        sa.Column("deep_sleep_seconds", sa.Integer, nullable=True),
        sa.Column("rem_sleep_seconds", sa.Integer, nullable=True),
        sa.Column("light_sleep_seconds", sa.Integer, nullable=True),
        sa.Column("awake_seconds", sa.Integer, nullable=True),
        sa.Column("sleep_efficiency", sa.Float, nullable=True),
        sa.Column("sleep_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sleep_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_data", postgresql.JSONB, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )

    # health_alerts
    op.create_table(
        "health_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("alert_type", sa.String(50), nullable=False, index=True),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.String(2000), nullable=False),
        sa.Column("evidence", postgresql.JSONB, nullable=True),
        sa.Column("detected_date", sa.Date, nullable=False),
        sa.Column("dismissed_date", sa.Date, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_table("health_alerts")
    op.drop_table("sleep_logs")
    op.drop_table("daily_metrics")
    op.drop_table("personal_records")
    op.drop_table("lifting_sets")
    op.drop_table("lifting_sessions")
    op.drop_table("activity_streams")
    op.drop_table("activities")
    op.drop_table("oauth_connections")
    op.drop_table("users")
