"""Add body composition columns to weight_logs (Withings integration).

Stores Withings scale BIA data (body fat %, muscle mass, bone mass,
hydration, visceral fat, BMI) alongside weight. All columns nullable so
existing Whoop/manual rows are unaffected.

Revision ID: 060
Revises: 059
Create Date: 2026-09-17
"""

import sqlalchemy as sa

from alembic import op

revision = "060"
down_revision = "059"
branch_labels = None
depends_on = None


_COMPOSITION_COLUMNS = [
    "body_fat_percent",
    "fat_mass_kg",
    "lean_mass_kg",
    "muscle_mass_kg",
    "bone_mass_kg",
    "hydration_percent",
    "visceral_fat_index",
    "bmi",
]


def upgrade() -> None:
    for col in _COMPOSITION_COLUMNS:
        op.add_column("weight_logs", sa.Column(col, sa.Float(), nullable=True))


def downgrade() -> None:
    for col in _COMPOSITION_COLUMNS:
        op.drop_column("weight_logs", col)
