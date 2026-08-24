"""add_oauth_unique_constraint

Revision ID: 024
Revises: 023
Create Date: 2026-08-24
"""

from alembic import op

revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_oauth_user_provider",
        "oauth_connections",
        ["user_id", "provider"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_oauth_user_provider", "oauth_connections", type_="unique")
