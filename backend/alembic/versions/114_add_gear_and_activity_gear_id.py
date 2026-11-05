"""Add ``gear`` and ``activities.gear_id``.

Strava has always returned ``gear_id`` on every activity summary. It has been
sitting in ``activities.raw_data`` unread, so the app could not answer "how far
has this bike gone" — the one maintenance question a cyclist actually asks.

The table (rather than a string column) is the point: a provider can rename gear
without it becoming a different object, and distance accumulates per gear across
every ride. A bare string would treat a rename as a new bike.

``distance_synced_at`` exists so the refresh can be gated. A gear's total is a
slowly-moving number; calling it on every sync would spend the read bucket
(100/15 min, 1000/day by default) on a value that changed by one ride.

``wear_threshold_meters`` is nullable and **not** defaulted: a service interval
depends on conditions and on the specific shoe or chain, and a default would be a
number presented as knowledge. NULL means "not set", and the API reports no wear
percentage rather than inventing one.

Revision ID: 114
Revises: 113
Create Date: 2026-11-05
"""

import sqlalchemy as sa

from alembic import op

revision = "114"
down_revision = "113"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gear",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("provider_gear_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("brand_name", sa.String(length=120), nullable=True),
        sa.Column("model_name", sa.String(length=120), nullable=True),
        sa.Column("distance_meters", sa.Float(), nullable=True),
        sa.Column("distance_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("wear_threshold_meters", sa.Float(), nullable=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "provider",
            "provider_gear_id",
            name="uq_gear_user_provider_provider_id",
        ),
    )
    op.create_index("ix_gear_user_id", "gear", ["user_id"])

    op.add_column("activities", sa.Column("gear_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_activities_gear_id",
        "activities",
        "gear",
        ["gear_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_activities_gear_id", "activities", ["gear_id"])


def downgrade() -> None:
    op.drop_index("ix_activities_gear_id", table_name="activities")
    op.drop_constraint("fk_activities_gear_id", "activities", type_="foreignkey")
    op.drop_column("activities", "gear_id")
    op.drop_index("ix_gear_user_id", table_name="gear")
    op.drop_table("gear")
