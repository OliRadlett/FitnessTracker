"""Add Wahoo zone-set sync: ``wahoo_zone_sets`` + ``cycling_profiles.push_wahoo_zones``.

The weekly FTP auto-estimate (``auto_estimate_ftp_weekly``) has always moved FTP
silently, and the ELEMNT keeps colouring the live zone against whatever FTP it was
told last — so the charts and the head unit disagree for as long as the athlete
does not re-enter it by hand. Pushed structured workouts suffer the same way, since
``wahoo_plan_file`` emits targets as *fractions* of FTP and the device resolves them
against its own. See ``plans/wahoo-zone-sync.md``.

``wahoo_zone_sets`` is keyed by Wahoo's own shape (one zone set per sport profile →
``(user, zone kind, family, location)``) because indoor and outdoor cycling can hold
different sets, and each needs its own anchor/rollback state. ``prior`` is the
snapshot taken before our *first* write, which is what makes revert mean revert.

Both JSONB columns are ``none_as_null=True``: revert **clears** ``prior``, and
without the flag the cleared value is the JSON literal ``null``, so the row would
still match ``IS NOT NULL`` and "has a snapshot" would stay true forever
(AGENTS.md pitfall 28 — migration 092 repaired exactly this class of bug).

Dialect note: ``JSONB`` is imported from ``sqlalchemy.dialects.postgresql``, never
referenced as ``sa.JSONB()`` (pitfall 22 — that name does not exist on the top-level
module, and the resulting ``AttributeError`` reverts the *whole* migration under
transactional DDL).

Revision ID: 100
Revises: 099
Create Date: 2026-10-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "100"
down_revision = "099"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "wahoo_zone_sets",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        # "power" today; "heart_rate" reserved but unwritten — no documented
        # Wahoo endpoint exposes HR zones (plan §3.2).
        sa.Column("zone_kind", sa.String(12), nullable=False),
        sa.Column("workout_type_family_id", sa.Integer(), nullable=False),
        # 0 indoor / 1 outdoor / 255 unknown.
        sa.Column("workout_type_location_id", sa.Integer(), nullable=False),
        sa.Column("wahoo_zone_set_id", sa.Integer(), nullable=True),
        sa.Column("anchor_value", sa.Float(), nullable=True),
        # postgresql.JSONB with none_as_null so clearing a snapshot writes SQL
        # NULL rather than the JSON literal null (AGENTS.md pitfall 28).
        sa.Column(
            "boundaries", postgresql.JSONB(none_as_null=True), nullable=True
        ),
        sa.Column("prior", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("pushed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(300), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        # One tracked set per (kind, family, location) — see the model docstring.
        sa.UniqueConstraint(
            "user_id",
            "zone_kind",
            "workout_type_family_id",
            "workout_type_location_id",
            name="uq_wahoo_zone_sets_user_kind_set",
        ),
    )
    op.create_index("ix_wahoo_zone_sets_user_id", "wahoo_zone_sets", ["user_id"])

    # Opt-in, default off: writes to a third-party account need consent.
    op.add_column(
        "cycling_profiles",
        sa.Column(
            "push_wahoo_zones",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("cycling_profiles", "push_wahoo_zones")
    op.drop_index("ix_wahoo_zone_sets_user_id", table_name="wahoo_zone_sets")
    op.drop_table("wahoo_zone_sets")
