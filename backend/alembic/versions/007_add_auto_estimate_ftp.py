"""Add auto_estimate_ftp column to cycling_profiles.

Revision ID: 007
Revises: 006
Create Date: 2026-08-16
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cycling_profiles",
        sa.Column("auto_estimate_ftp", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("cycling_profiles", "auto_estimate_ftp")
