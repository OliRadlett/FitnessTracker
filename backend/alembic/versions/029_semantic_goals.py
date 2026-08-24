"""Semantic goals: metric/filter_json/starting_value columns + goal_checkins table.

Revision ID: 029
Revises: 028
Create Date: 2026-08-24

Data migration maps legacy ``goal_type`` values to semantic metric keys:
    ftp_target      → ftp_watts
    weight_target   → body_weight
    weekly_sessions → weekly_sessions
    distance_target → monthly_distance_km
    1rm_target      → estimated_1rm (+ exercise parsed from notes into filter_json)

Unknown goal_types fall back to "ftp_watts" with a logged warning.
``starting_value`` is intentionally left NULL — the service layer backfills it
lazily on the next read (compute_goal_state).
"""

import json
import logging

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

logger = logging.getLogger("alembic.029_semantic_goals")

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None

# Legacy goal_type → semantic metric key
GOAL_TYPE_TO_METRIC = {
    "ftp_target": "ftp_watts",
    "weight_target": "body_weight",
    "weekly_sessions": "weekly_sessions",
    "distance_target": "monthly_distance_km",
    "1rm_target": "estimated_1rm",
}

# Reverse map for best-effort downgrade
METRIC_TO_GOAL_TYPE = {
    "ftp_watts": "ftp_target",
    "body_weight": "weight_target",
    "weekly_sessions": "weekly_sessions",
    "monthly_distance_km": "distance_target",
    "estimated_1rm": "1rm_target",
}


def upgrade() -> None:
    # ── 1. New Goal columns ────────────────────────────────────────────────
    op.add_column(
        "goals",
        sa.Column(
            "metric",
            sa.String(length=50),
            nullable=False,
            server_default="ftp_watts",
        ),
    )
    op.add_column("goals", sa.Column("filter_json", JSONB(), nullable=True))
    op.add_column("goals", sa.Column("starting_value", sa.Float(), nullable=True))

    # ── 2. goal_checkins table ─────────────────────────────────────────────
    op.create_table(
        "goal_checkins",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "goal_id",
            UUID(as_uuid=True),
            sa.ForeignKey("goals.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("check_in_date", sa.Date(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("alignment_pct", sa.Float(), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column(
            "source", sa.String(length=20), nullable=False, server_default="auto"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_goal_checkins_user_id", "goal_checkins", ["user_id"])
    op.create_index("ix_goal_checkins_goal_id", "goal_checkins", ["goal_id"])

    # ── 3. Data migration: goal_type → metric ──────────────────────────────
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, goal_type, notes FROM goals")).fetchall()
    for row in rows:
        legacy = row.goal_type
        metric = GOAL_TYPE_TO_METRIC.get(legacy)
        filter_json = None
        if metric is None:
            logger.warning(
                "Unknown legacy goal_type %r on goal %s — defaulting to "
                "'ftp_watts' metric",
                legacy,
                row.id,
            )
            metric = "ftp_watts"
        if legacy == "1rm_target" and row.notes:
            # Exercise name lived in notes; keep original notes text intact
            filter_json = {"exercise": row.notes}
        conn.execute(
            sa.text(
                "UPDATE goals SET metric = :metric, "
                "filter_json = CAST(:filter_json AS JSONB) WHERE id = :id"
            ),
            {
                "metric": metric,
                "filter_json": json.dumps(filter_json) if filter_json else None,
                "id": str(row.id),
            },
        )

    # ── 4. Drop legacy column ──────────────────────────────────────────────
    op.drop_column("goals", "goal_type")


def downgrade() -> None:
    # Best-effort reverse: recreate goal_type from metric
    # (server_default satisfies NOT NULL during ADD COLUMN on populated tables)
    op.add_column(
        "goals",
        sa.Column(
            "goal_type",
            sa.String(length=50),
            nullable=False,
            server_default="ftp_target",
        ),
    )
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, metric FROM goals")).fetchall()
    for row in rows:
        legacy = METRIC_TO_GOAL_TYPE.get(row.metric, "ftp_target")
        conn.execute(
            sa.text("UPDATE goals SET goal_type = :gt WHERE id = :id"),
            {"gt": legacy, "id": str(row.id)},
        )

    op.drop_column("goals", "starting_value")
    op.drop_column("goals", "filter_json")
    op.drop_column("goals", "metric")

    op.drop_index("ix_goal_checkins_goal_id", table_name="goal_checkins")
    op.drop_index("ix_goal_checkins_user_id", table_name="goal_checkins")
    op.drop_table("goal_checkins")
