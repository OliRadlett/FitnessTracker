"""add lifting_sessions session classification (Jev split/lift/intent)

Revision ID: 100
Revises: 099
Create Date: 2026-10-15
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "100"
down_revision = "099"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("session_split", sa.String(length=32)),
    ("session_lift", sa.String(length=32)),
    ("session_class", sa.String(length=32)),
)


def upgrade() -> None:
    for name, type_ in _COLUMNS:
        op.add_column(
            "lifting_sessions", sa.Column(name, type_, nullable=True)
        )
    op.add_column(
        "lifting_sessions",
        sa.Column(
            "ai_classification",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("lifting_sessions", "ai_classification")
    for name, _ in _COLUMNS:
        op.drop_column("lifting_sessions", name)
