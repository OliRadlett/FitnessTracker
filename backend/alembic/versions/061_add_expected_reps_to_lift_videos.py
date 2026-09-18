"""add expected_reps to lift_videos (user-declared rep count for calibration)

Revision ID: 061
Revises: 060
Create Date: 2026-09-18
"""
import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('lift_videos', sa.Column('expected_reps', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('lift_videos', 'expected_reps')
