"""add_oauth_unique_constraint

Revision ID: 024
Revises: 023
Create Date: 2026-08-24
"""

from sqlalchemy import inspect

from alembic import op

revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {
        c["name"] for c in inspector.get_unique_constraints("oauth_connections")
    }
    if "uq_oauth_user_provider" not in existing:
        op.create_unique_constraint(
            "uq_oauth_user_provider",
            "oauth_connections",
            ["user_id", "provider"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {
        c["name"] for c in inspector.get_unique_constraints("oauth_connections")
    }
    if "uq_oauth_user_provider" in existing:
        op.drop_constraint(
            "uq_oauth_user_provider", "oauth_connections", type_="unique"
        )
