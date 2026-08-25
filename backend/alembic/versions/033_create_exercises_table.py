"""Create exercises table and seed from built-in exercise_db.

Revision ID: 033
Revises: 032
Create Date: 2026-08-25
"""

import json
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exercises",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("category", sa.String(50), nullable=False, server_default="accessory"),
        sa.Column("aliases", JSONB(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.UniqueConstraint("user_id", "name", name="uq_exercise_user_name"),
    )
    op.create_index("ix_exercises_user_id", "exercises", ["user_id"])
    op.create_index("ix_exercises_name", "exercises", ["name"])

    # Seed from built-in exercise_db (global rows, user_id=NULL).
    conn = op.get_bind()

    # Import the static DB to seed from.
    import os
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from app.services.exercise_db import _ALIASES, EXERCISE_DB

    # Build alias lookup: canonical → [aliases]
    canonical_aliases: dict[str, list[str]] = {}
    for alias, canonical in _ALIASES.items():
        canonical_aliases.setdefault(canonical, []).append(alias)

    for category, exercises in EXERCISE_DB.items():
        for name in exercises:
            aliases = canonical_aliases.get(name)
            conn.execute(
                sa.text(
                    "INSERT INTO exercises (id, user_id, name, category, aliases, is_active) "
                    "VALUES (:id, NULL, :name, :category, :aliases, true) "
                    "ON CONFLICT DO NOTHING"
                ),
                {
                    "id": uuid.uuid4(),
                    "name": name,
                    "category": category,
                    "aliases": json.dumps(aliases) if aliases else None,
                },
            )

    # Add missing exercises that users have logged (from PBs / training templates).
    missing = [
        ("Back Extension", "accessory", ["back extension", "back ext", "hyperextension"]),
        ("Incline Dumbbell Press", "compound", ["incline db press", "incline dumbbell press"]),
        ("Triceps Pushdown", "accessory", ["triceps pushdown", "tricep pushdown"]),
        ("Chest Supported Row", "compound", ["chest supported row", "seal row"]),
        ("Hip Thrust", "compound", ["hip thrust", "barbell hip thrust"]),
    ]
    for name, category, aliases in missing:
        conn.execute(
            sa.text(
                "INSERT INTO exercises (id, user_id, name, category, aliases, is_active) "
                "VALUES (:id, NULL, :name, :category, :aliases, true) "
                "ON CONFLICT DO NOTHING"
            ),
            {
                "id": uuid.uuid4(),
                "name": name,
                "category": category,
                "aliases": json.dumps(aliases),
            },
        )


def downgrade() -> None:
    op.drop_table("exercises")
